require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'grateful_edutech_cbt',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z'
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      } : undefined
    })
  : null;

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'test';
}

async function uniqueTestSlug(organizationId, name) {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  while (true) {
    const [rows] = await pool.query(
      'SELECT id FROM tests WHERE organization_id = ? AND slug = ? LIMIT 1',
      [organizationId, slug]
    );
    if (!rows.length) return slug;
    slug = `${base}-${n++}`;
  }
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      organizationId: user.organization_id,
      role: user.role,
      email: user.email
    },
    process.env.JWT_SECRET || 'change-this-secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'change-this-secret');
    next();
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token.' });
  }
}

function requireInstructor(req, res, next) {
  if (!['instructor', 'org_admin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Instructor access required.' });
  }
  next();
}

async function sendVerificationEmail(user, rawToken) {
  const verifyUrl = `${process.env.APP_URL || `http://localhost:${PORT}`}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;

  if (!mailer) {
    console.log(`[EMAIL DEV] Verify ${user.email}: ${verifyUrl}`);
    return;
  }

  await mailer.sendMail({
    from: process.env.SMTP_FROM || 'Grateful EduTech CBT <no-reply@example.com>',
    to: user.email,
    subject: 'Verify your Grateful EduTech account',
    html: `<p>Hello ${user.full_name},</p><p>Verify your instructor account by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
  });
}

function normalizeQuestions(input) {
  if (!Array.isArray(input)) return [];
  return input.map((q, index) => ({
    questionText: String(q.questionText || q.q || '').trim(),
    type: q.type || 'single_choice',
    marks: Number(q.marks || 1),
    options: Array.isArray(q.options) ? q.options.map((o, optionIndex) => ({
      key: String(o.key || String.fromCharCode(65 + optionIndex)).slice(0, 1).toUpperCase(),
      text: String(o.text || o.optionText || o.value || '').trim(),
      correct: Boolean(o.correct ?? o.isCorrect ?? false)
    })).filter(o => o.text) : [],
    questionNumber: index + 1
  })).filter(q => q.questionText && q.options.length >= 2);
}

function parseQuestionText(text) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  const blocks = clean.split(/(?=^\s*\d+[.)]\s+)/gm).map(s => s.trim()).filter(Boolean);
  const questions = [];

  for (const block of blocks) {
    const first = block.match(/^\s*(\d+)[.)]\s+([\s\S]*?)(?=\n\s*A[.)]\s+)/i);
    if (!first) continue;

    const questionText = first[2].replace(/\s+/g, ' ').trim();
    const optionMatches = [...block.matchAll(/(?:^|\n)\s*([A-D])[.)]\s+([\s\S]*?)(?=\n\s*[A-D][.)]\s+|$)/gi)];
    const options = optionMatches.map(m => ({
      key: m[1].toUpperCase(),
      text: m[2].replace(/\s+/g, ' ').trim(),
      correct: false
    })).filter(o => o.text);

    if (questionText && options.length >= 2) {
      questions.push({ questionText, type: 'single_choice', marks: 1, options });
    }
  }

  return questions.map((q, i) => ({ ...q, questionNumber: i + 1 }));
}

async function extractQuestions(file) {
  let text = '';
  if (file.mimetype === 'application/pdf') {
    const parsed = await pdfParse(file.buffer);
    text = parsed.text;
  } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    text = parsed.value;
  } else {
    throw new Error('Legacy .doc files are accepted by the upload UI but cannot be parsed by this server version. Convert the file to .docx or PDF.');
  }
  return parseQuestionText(text);
}

async function replaceTestQuestions(connection, testId, questions) {
  await connection.query('DELETE FROM questions WHERE test_id = ?', [testId]);
  for (const question of normalizeQuestions(questions)) {
    const [qResult] = await connection.query(
      'INSERT INTO questions (test_id, question_number, question_text, question_type, marks) VALUES (?, ?, ?, ?, ?)',
      [testId, question.questionNumber, question.questionText, question.type, question.marks]
    );
    for (const option of question.options) {
      await connection.query(
        'INSERT INTO question_options (question_id, option_key, option_text, is_correct) VALUES (?, ?, ?, ?)',
        [qResult.insertId, option.key, option.text, option.correct ? 1 : 0]
      );
    }
  }
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', service: 'grateful-edutech-cbt', database: 'connected' });
}));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { fullName, name, phone, email, password, organizationName } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const finalName = String(fullName || name || '').trim();

  if (!finalName || !phone || !normalizedEmail || !password) {
    return res.status(400).json({ message: 'Full name, phone, email and password are required.' });
  }
  if (!/^\d{11}$/.test(String(phone))) {
    return res.status(400).json({ message: 'Phone number must contain exactly 11 digits.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const orgName = String(organizationName || `${finalName}'s Organization`).trim();
    const orgSlugBase = slugify(orgName);
    let orgSlug = orgSlugBase;
    let suffix = 1;
    while (true) {
      const [existing] = await connection.query('SELECT id FROM organizations WHERE slug = ? LIMIT 1', [orgSlug]);
      if (!existing.length) break;
      orgSlug = `${orgSlugBase}-${suffix++}`;
    }

    const [orgResult] = await connection.query(
      'INSERT INTO organizations (name, slug, email, phone) VALUES (?, ?, ?, ?)',
      [orgName, orgSlug, normalizedEmail, phone]
    );

    const passwordHash = await bcrypt.hash(password, 12);
    const [userResult] = await connection.query(
      'INSERT INTO users (organization_id, full_name, phone, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
      [orgResult.insertId, finalName, phone, normalizedEmail, passwordHash, 'org_admin']
    );

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await connection.query(
      'INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))',
      [userResult.insertId, tokenHash]
    );

    await connection.commit();

    const user = { id: userResult.insertId, organization_id: orgResult.insertId, full_name: finalName, email: normalizedEmail };
    await sendVerificationEmail(user, rawToken);

    res.status(201).json({
      message: 'Account created. Verify your email before logging in.',
      user: { id: user.id, name: user.full_name, email: user.email },
      developmentVerificationToken: mailer ? undefined : rawToken
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'An account with that email already exists.' });
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/auth/verify-email', asyncHandler(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).send('Invalid verification link.');

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const [rows] = await pool.query(
    `SELECT ev.id, ev.user_id FROM email_verifications ev
     WHERE ev.token_hash = ? AND ev.used_at IS NULL AND ev.expires_at > NOW() LIMIT 1`,
    [tokenHash]
  );
  if (!rows.length) return res.status(400).send('This verification link is invalid or expired.');

  await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = ?', [rows[0].user_id]);
  await pool.query('UPDATE email_verifications SET used_at = NOW() WHERE id = ?', [rows[0].id]);
  res.send('<h2>Email verified successfully</h2><p>You can now return to the CBT platform and log in.</p>');
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

  const [rows] = await pool.query(
    `SELECT u.*, o.name AS organization_name, o.status AS organization_status
     FROM users u JOIN organizations o ON o.id = u.organization_id
     WHERE u.email = ? LIMIT 1`,
    [email]
  );
  if (!rows.length) return res.status(401).json({ message: 'Incorrect email or password.' });
  const user = rows[0];
  if (user.status !== 'active' || user.organization_status !== 'active') return res.status(403).json({ message: 'This account or organization is not active.' });
  if (!user.email_verified_at) return res.status(403).json({ message: 'Please verify your email before logging in.' });
  if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ message: 'Incorrect email or password.' });

  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      name: user.full_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      organizationId: user.organization_id,
      organizationName: user.organization_name
    }
  });
}));

app.get('/api/auth/me', auth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.phone, u.email, u.role, u.organization_id, o.name AS organization_name
     FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.id = ? LIMIT 1`,
    [req.user.sub]
  );
  if (!rows.length) return res.status(404).json({ message: 'User not found.' });
  res.json({ user: rows[0] });
}));

app.post('/api/auth/change-password', auth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ message: 'Current password and a new password of at least 8 characters are required.' });
  }
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.user.sub]);
  if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 12), req.user.sub]);
  res.json({ message: 'Password updated successfully.' });
}));

app.get('/api/dashboard', auth, requireInstructor, asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId;
  const [[testStats]] = await pool.query(
    `SELECT COUNT(*) AS totalTests,
      SUM(status='published') AS activeTests
     FROM tests WHERE organization_id = ?`, [orgId]
  );
  const [[candidateStats]] = await pool.query(
    `SELECT COUNT(*) AS candidates, SUM(status='submitted') AS completedTests,
      SUM(status='submitted' AND result_released_at IS NULL) AS resultsPending
     FROM attempts a JOIN tests t ON t.id = a.test_id WHERE t.organization_id = ?`, [orgId]
  );
  const [recentTests] = await pool.query(
    `SELECT t.id, t.name, COUNT(q.id) AS questions, t.status, t.duration_minutes, t.max_attempts
     FROM tests t LEFT JOIN questions q ON q.test_id=t.id
     WHERE t.organization_id=? GROUP BY t.id ORDER BY t.created_at DESC LIMIT 10`, [orgId]
  );
  res.json({ stats: { ...testStats, ...candidateStats }, recentTests });
}));

app.get('/api/tests', auth, requireInstructor, asyncHandler(async (req, res) => {
  const [tests] = await pool.query(
    `SELECT t.id, t.name, t.slug, t.instructions, t.duration_minutes, t.max_attempts,
      t.release_result_immediately, t.allow_candidate_review, t.auto_submit_on_timeout,
      t.result_sender_name, t.status, t.published_at, t.created_at,
      COUNT(q.id) AS question_count
     FROM tests t LEFT JOIN questions q ON q.test_id=t.id
     WHERE t.organization_id=? GROUP BY t.id ORDER BY t.created_at DESC`,
    [req.user.organizationId]
  );
  res.json({ tests });
}));

app.post('/api/tests', auth, requireInstructor, asyncHandler(async (req, res) => {
  const {
    name, instructions, durationMinutes = 60, maxAttempts = 1,
    releaseResultImmediately = true, allowCandidateReview = true,
    autoSubmitOnTimeout = true, accessPassword, resultSenderName
  } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ message: 'Test name is required.' });
  if (Number(durationMinutes) < 1 || Number(maxAttempts) < 1) return res.status(400).json({ message: 'Duration and attempts must be positive.' });

  const slug = await uniqueTestSlug(req.user.organizationId, name);
  const passwordHash = accessPassword ? await bcrypt.hash(String(accessPassword), 10) : null;
  const [result] = await pool.query(
    `INSERT INTO tests
      (organization_id, instructor_id, name, slug, instructions, duration_minutes, max_attempts,
       release_result_immediately, allow_candidate_review, auto_submit_on_timeout, access_password_hash, result_sender_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.organizationId, req.user.sub, String(name).trim(), slug, instructions || null,
      Number(durationMinutes), Number(maxAttempts), !!releaseResultImmediately, !!allowCandidateReview,
      !!autoSubmitOnTimeout, passwordHash, resultSenderName || 'Grateful EduTech CBT']
  );
  res.status(201).json({ id: result.insertId, slug, message: 'Test saved as draft.' });
}));

app.get('/api/tests/:id', auth, requireInstructor, asyncHandler(async (req, res) => {
  const [tests] = await pool.query('SELECT * FROM tests WHERE id=? AND organization_id=? LIMIT 1', [req.params.id, req.user.organizationId]);
  if (!tests.length) return res.status(404).json({ message: 'Test not found.' });
  const [questions] = await pool.query(
    `SELECT q.id, q.question_number, q.question_text, q.question_type, q.marks,
      qo.id AS option_id, qo.option_key, qo.option_text, qo.is_correct
     FROM questions q LEFT JOIN question_options qo ON qo.question_id=q.id
     WHERE q.test_id=? ORDER BY q.question_number, qo.option_key`, [req.params.id]
  );
  const grouped = [];
  for (const row of questions) {
    let q = grouped.find(x => x.id === row.id);
    if (!q) {
      q = { id: row.id, questionNumber: row.question_number, questionText: row.question_text, type: row.question_type, marks: row.marks, options: [] };
      grouped.push(q);
    }
    if (row.option_id) q.options.push({ id: row.option_id, key: row.option_key, text: row.option_text, correct: !!row.is_correct });
  }
  res.json({ test: tests[0], questions: grouped });
}));

app.put('/api/tests/:id', auth, requireInstructor, asyncHandler(async (req, res) => {
  const fields = {
    name: req.body.name,
    instructions: req.body.instructions,
    duration_minutes: req.body.durationMinutes,
    max_attempts: req.body.maxAttempts,
    release_result_immediately: req.body.releaseResultImmediately,
    allow_candidate_review: req.body.allowCandidateReview,
    auto_submit_on_timeout: req.body.autoSubmitOnTimeout,
    result_sender_name: req.body.resultSenderName
  };
  const updates = [];
  const values = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value !== undefined) { updates.push(`${column}=?`); values.push(value); }
  }
  if (!updates.length) return res.status(400).json({ message: 'No changes supplied.' });
  values.push(req.params.id, req.user.organizationId);
  const [result] = await pool.query(`UPDATE tests SET ${updates.join(', ')} WHERE id=? AND organization_id=?`, values);
  if (!result.affectedRows) return res.status(404).json({ message: 'Test not found.' });
  res.json({ message: 'Test updated successfully.' });
}));

app.post('/api/tests/:id/questions', auth, requireInstructor, asyncHandler(async (req, res) => {
  const [tests] = await pool.query('SELECT id FROM tests WHERE id=? AND organization_id=? LIMIT 1', [req.params.id, req.user.organizationId]);
  if (!tests.length) return res.status(404).json({ message: 'Test not found.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await replaceTestQuestions(connection, req.params.id, req.body.questions || []);
    await connection.commit();
    res.json({ message: 'Questions saved successfully.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/tests/:id/import', auth, requireInstructor, upload.single('questionFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'PDF, DOC or DOCX question file is required.' });
  const [tests] = await pool.query('SELECT id FROM tests WHERE id=? AND organization_id=? LIMIT 1', [req.params.id, req.user.organizationId]);
  if (!tests.length) return res.status(404).json({ message: 'Test not found.' });

  const [importResult] = await pool.query(
    'INSERT INTO test_imports (test_id, original_filename, mime_type) VALUES (?, ?, ?)',
    [req.params.id, req.file.originalname, req.file.mimetype]
  );

  try {
    const questions = await extractQuestions(req.file);
    await pool.query('UPDATE test_imports SET status=?, completed_at=NOW() WHERE id=?', ['completed', importResult.insertId]);
    res.json({ message: 'Question file processed.', importId: importResult.insertId, questions, questionCount: questions.length });
  } catch (error) {
    await pool.query('UPDATE test_imports SET status=?, error_message=?, completed_at=NOW() WHERE id=?', ['failed', error.message, importResult.insertId]);
    res.status(422).json({ message: 'Could not extract questions from the uploaded file.', error: error.message });
  }
}));

app.post('/api/tests/:id/publish', auth, requireInstructor, asyncHandler(async (req, res) => {
  const [tests] = await pool.query('SELECT id, slug FROM tests WHERE id=? AND organization_id=? LIMIT 1', [req.params.id, req.user.organizationId]);
  if (!tests.length) return res.status(404).json({ message: 'Test not found.' });
  const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM questions WHERE test_id=?', [req.params.id]);
  if (!Number(count.total)) return res.status(400).json({ message: 'Add at least one question before publishing.' });

  await pool.query('UPDATE tests SET status="published", published_at=NOW() WHERE id=?', [req.params.id]);
  const base = process.env.APP_URL || `http://localhost:${PORT}`;
  res.json({ message: 'Test published successfully.', link: `${base}/test/${tests[0].slug}` });
}));

app.post('/api/candidate/start', asyncHandler(async (req, res) => {
  const { slug, name, email, phone, password } = req.body;
  if (!slug || !name || !email || !phone || !password) return res.status(400).json({ message: 'Test link, name, email, phone and password are required.' });
  if (!/^\d{11}$/.test(String(phone))) return res.status(400).json({ message: 'Phone number must contain exactly 11 digits.' });

  const [tests] = await pool.query('SELECT * FROM tests WHERE slug=? AND status="published" LIMIT 1', [slug]);
  if (!tests.length) return res.status(404).json({ message: 'Test not found or no longer available.' });
  const test = tests[0];
  if (test.access_password_hash && !(await bcrypt.compare(String(password), test.access_password_hash))) {
    return res.status(401).json({ message: 'Incorrect test password.' });
  }

  const [attemptRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM attempts WHERE test_id=? AND candidate_email=?',
    [test.id, String(email).trim().toLowerCase()]
  );
  if (Number(attemptRows[0].total) >= test.max_attempts) return res.status(403).json({ message: 'Maximum attempts for this email have been reached.' });

  const attemptNumber = Number(attemptRows[0].total) + 1;
  const started = new Date();
  const expires = new Date(started.getTime() + Number(test.duration_minutes) * 60000);
  const [result] = await pool.query(
    `INSERT INTO attempts (test_id, candidate_name, candidate_email, candidate_phone, attempt_number, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [test.id, String(name).trim(), String(email).trim().toLowerCase(), String(phone), attemptNumber, started, expires]
  );

  const [questions] = await pool.query(
    `SELECT q.id, q.question_number, q.question_text, q.question_type, q.marks,
      qo.id AS option_id, qo.option_key, qo.option_text
     FROM questions q LEFT JOIN question_options qo ON qo.question_id=q.id
     WHERE q.test_id=? ORDER BY q.question_number, qo.option_key`, [test.id]
  );
  const grouped = [];
  for (const row of questions) {
    let q = grouped.find(x => x.id === row.id);
    if (!q) { q = { id: row.id, questionNumber: row.question_number, questionText: row.question_text, type: row.question_type, marks: row.marks, options: [] }; grouped.push(q); }
    if (row.option_id) q.options.push({ id: row.option_id, key: row.option_key, text: row.option_text });
  }

  res.status(201).json({
    attemptId: result.insertId,
    test: { id: test.id, name: test.name, durationMinutes: test.duration_minutes, allowCandidateReview: !!test.allow_candidate_review, autoSubmitOnTimeout: !!test.auto_submit_on_timeout },
    expiresAt: expires,
    questions: grouped
  });
}));

app.post('/api/candidate/:attemptId/submit', asyncHandler(async (req, res) => {
  const attemptId = req.params.attemptId;
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const [attemptRows] = await pool.query(
    `SELECT a.*, t.release_result_immediately, t.status AS test_status
     FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.id=? LIMIT 1`, [attemptId]
  );
  if (!attemptRows.length) return res.status(404).json({ message: 'Attempt not found.' });
  const attempt = attemptRows[0];
  if (attempt.status !== 'in_progress') return res.status(409).json({ message: 'This attempt has already been submitted.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let score = 0;
    let totalMarks = 0;

    const [questions] = await connection.query(
      `SELECT q.id, q.marks, qo.id AS correct_option_id
       FROM questions q LEFT JOIN question_options qo ON qo.question_id=q.id AND qo.is_correct=1
       WHERE q.test_id=? ORDER BY q.question_number`, [attempt.test_id]
    );

    const answerMap = new Map(answers.map(a => [Number(a.questionId), Number(a.optionId)]));
    for (const q of questions) {
      totalMarks += Number(q.marks);
      const selected = answerMap.get(Number(q.id));
      const correct = selected !== undefined && selected === Number(q.correct_option_id);
      if (correct) score += Number(q.marks);
      await connection.query(
        `INSERT INTO attempt_answers (attempt_id, question_id, selected_option_id, is_correct, marks_awarded)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE selected_option_id=VALUES(selected_option_id), is_correct=VALUES(is_correct), marks_awarded=VALUES(marks_awarded), answered_at=NOW()`,
        [attemptId, q.id, selected || null, selected === undefined ? null : correct ? 1 : 0, correct ? q.marks : 0]
      );
    }

    const percentage = totalMarks ? (score / totalMarks) * 100 : 0;
    const released = attempt.release_result_immediately ? new Date() : null;
    await connection.query(
      `UPDATE attempts SET status='submitted', submitted_at=NOW(), score=?, percentage=?, result_released_at=? WHERE id=?`,
      [score, percentage, released, attemptId]
    );
    await connection.commit();

    res.json({
      message: 'Test submitted successfully.',
      resultReleased: !!attempt.release_result_immediately,
      score,
      totalMarks,
      percentage: Number(percentage.toFixed(2))
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/results', auth, requireInstructor, asyncHandler(async (req, res) => {
  const testId = req.query.testId;
  const search = String(req.query.search || '').trim();
  const params = [req.user.organizationId];
  let sql = `SELECT a.id, a.candidate_name, a.candidate_email, a.candidate_phone, a.attempt_number,
      a.score, a.percentage, a.status, a.result_released_at, a.submitted_at, t.id AS test_id, t.name AS test_name
      FROM attempts a JOIN tests t ON t.id=a.test_id WHERE t.organization_id=?`;
  if (testId) { sql += ' AND t.id=?'; params.push(testId); }
  if (search) { sql += ' AND (a.candidate_name LIKE ? OR a.candidate_email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY a.submitted_at DESC, a.id DESC LIMIT 500';
  const [results] = await pool.query(sql, params);
  res.json({ results });
}));

app.post('/api/results/:attemptId/release', auth, requireInstructor, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.id=? AND t.organization_id=? LIMIT 1`,
    [req.params.attemptId, req.user.organizationId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Result not found.' });
  await pool.query('UPDATE attempts SET result_released_at=NOW() WHERE id=?', [req.params.attemptId]);
  res.json({ message: 'Result released successfully.' });
}));

app.get('/test/:slug', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ message: error.message });
  res.status(500).json({ message: 'Internal server error.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
});

app.listen(PORT, () => {
  console.log(`Grateful EduTech CBT server running on http://localhost:${PORT}`);
});
