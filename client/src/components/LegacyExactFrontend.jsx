import { useEffect, useState } from 'react';

/**
 * Compatibility bridge for the client's supplied frontend.
 * The original HTML/CSS/JS is the visual source of truth; this component
 * keeps the exact supplied markup available while the individual screens
 * are progressively converted into React components.
 */
export default function LegacyExactFrontend() {
  const [html, setHtml] = useState('');

  useEffect(() => {
    fetch('/legacy/index.html')
      .then((response) => response.text())
      .then(setHtml)
      .catch(() => setHtml('<p>Unable to load the supplied frontend.</p>'));
  }, []);

  return (
    <div
      className="legacy-exact-frontend"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
