const form = document.getElementById('surveyForm');
const otherCheckbox = document.getElementById('otherCheckbox');
const otherWrap = document.getElementById('otherWrap');
const otherText = document.getElementById('otherText');
const wordCount = document.getElementById('wordCount');
const wordError = document.getElementById('wordError');
const submitButton = document.getElementById('submitButton');
const formMessage = document.getElementById('formMessage');
const surveyCard = document.getElementById('surveyCard');
const resultsSection = document.getElementById('resultsSection');
const countsGrid = document.getElementById('countsGrid');
const otherBubbles = document.getElementById('otherBubbles');
const noOtherResponses = document.getElementById('noOtherResponses');
const totalResponses = document.getElementById('totalResponses');

const WORD_RE = /\S+/g;

function getWordCount(text) {
  return (text.match(WORD_RE) || []).length;
}

function setMessage(message, type = '') {
  formMessage.textContent = message;
  formMessage.className = `message ${type}`.trim();
}

function updateOtherState() {
  const enabled = otherCheckbox.checked;
  otherWrap.classList.toggle('hidden', !enabled);
  otherText.required = enabled;
  if (!enabled) {
    otherText.value = '';
    updateWordCount();
  }
}

function updateWordCount() {
  const count = getWordCount(otherText.value);
  wordCount.textContent = `${count} / 100 words`;
  wordError.textContent = count > 100 ? 'Please reduce your response to 100 words or fewer.' : '';
}

function disableForm(message) {
  [...form.querySelectorAll('input, textarea, button')].forEach((el) => { el.disabled = true; });
  setMessage(message, 'error');
}

function showResults(results) {
  countsGrid.replaceChildren();
  results.counts.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'count-card';

    const label = document.createElement('div');
    label.className = 'count-label';
    label.textContent = item.label;

    const number = document.createElement('div');
    number.className = 'count-number';
    number.textContent = String(Number(item.count));

    card.append(label, number);
    countsGrid.appendChild(card);
  });

  otherBubbles.replaceChildren();
  results.otherResponses.forEach((item) => {
    const bubble = document.createElement('span');
    bubble.className = 'bubble';
    bubble.textContent = item.text; // textContent prevents HTML/script injection.
    otherBubbles.appendChild(bubble);
  });
  noOtherResponses.classList.toggle('hidden', results.otherResponses.length !== 0);
  totalResponses.textContent = `${Number(results.totalResponses)} response${Number(results.totalResponses) === 1 ? '' : 's'}`;
  resultsSection.classList.remove('hidden');
}

async function loadStatus() {
  const response = await fetch('/api/status', { headers: { 'Accept': 'application/json' } });
  if (!response.ok) throw new Error('Status request failed');
  return response.json();
}

async function loadResults() {
  const response = await fetch('/api/results', { headers: { 'Accept': 'application/json' } });
  if (!response.ok) throw new Error('Results request failed');
  return response.json();
}

otherCheckbox.addEventListener('change', updateOtherState);
otherText.addEventListener('input', updateWordCount);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');

  const selected = [...form.querySelectorAll('input[name="option"]:checked')].map((input) => input.value);
  if (selected.length === 0) {
    setMessage('Please select at least one option.', 'error');
    return;
  }

  const otherWords = getWordCount(otherText.value);
  if (otherCheckbox.checked && (otherWords === 0 || otherWords > 100)) {
    setMessage(otherWords === 0 ? 'Please enter text for “Other”.' : 'Please reduce the “Other” response to 100 words or fewer.', 'error');
    otherText.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Submitting…';

  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        options: selected,
        otherText: otherCheckbox.checked ? otherText.value.trim() : ''
      })
    });
    const payload = await response.json();

    if (response.status === 409) {
      disableForm(payload.error || 'This IP address has already submitted a response.');
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to submit your response.');
    }

    [...form.querySelectorAll('input, textarea, button')].forEach((el) => { el.disabled = true; });
    setMessage('Your response has been submitted. Thank you!', 'success');
    showResults(payload.results);
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setMessage(error.message || 'Unable to submit your response.', 'error');
    submitButton.disabled = false;
    submitButton.textContent = 'Submit';
  }
});

(async function init() {
  updateOtherState();
  updateWordCount();
  try {
    const status = await loadStatus();
    if (status.submitted) {
      disableForm('A response from this IP address has already been submitted. Only one submission is allowed per visitor.');
    }
    // Keep the results section available after a repeat visit so users can see the aggregate results.
    if (status.submitted) {
      showResults(await loadResults());
    }
  } catch (error) {
    setMessage('The survey could not be initialized. Please refresh the page.', 'error');
  }
})();
