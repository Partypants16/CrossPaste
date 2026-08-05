const form = document.getElementById('access-form');
const errorMessage = document.getElementById('access-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;

  const token = document.getElementById('access-token').value;
  try {
    const response = await fetch('/api/access/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (response.ok) {
      window.location.href = '/';
      return;
    }

    const body = await response.json().catch(() => null);
    errorMessage.textContent = body?.error?.message || 'Unable to verify the access token.';
    errorMessage.hidden = false;
  } catch {
    errorMessage.textContent = 'Could not reach the server. Please check your connection and try again.';
    errorMessage.hidden = false;
  }
});
