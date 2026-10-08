import validate from '../utils/validate.mjs';

function choices(value, field) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10
    || !value.every((choice) => typeof choice === 'string' && choice.trim().length >= 1 && choice.trim().length <= 200)) {
    return { error: `${field} doit être une liste de 2 à 10 réponses (textes de 1 à 200 caractères)` };
  }

  const labels = value.map((choice) => choice.trim());

  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
    return { error: `${field} ne doit pas contenir deux fois la même réponse` };
  }

  return { value: labels.map((label) => ({ label })) };
}

function questions(value, field) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    return { error: `${field} doit être une liste de 1 à 20 questions` };
  }

  const errors = [];
  const clean = value.map((question, index) => {
    const result = validate(question, {
      label: { type: 'string', required: true, max: 300 },
      choices: { type: 'custom', required: true, check: choices }
    }, { prefix: `${field}[${index}].` });

    errors.push(...result.errors);
    return result.value;
  });

  return errors.length > 0 ? { error: errors } : { value: clean };
}

function answers(value, field) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    return { error: `${field} doit être une liste de réponses { question, choice }` };
  }

  const errors = [];
  const clean = value.map((answer, index) => {
    const result = validate(answer, {
      question: { type: 'id', required: true },
      choice: { type: 'id', required: true }
    }, { prefix: `${field}[${index}].` });

    errors.push(...result.errors);
    return result.value;
  });

  return errors.length > 0 ? { error: errors } : { value: clean };
}

export default {
  poll: {
    title: { type: 'string', required: true, max: 200 },
    questions: { type: 'custom', required: true, check: questions }
  },
  answer: {
    answers: { type: 'custom', required: true, check: answers }
  }
};
