import mongoose from 'mongoose';

import options from './options.mjs';

const ChoiceSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  }
});

const QuestionSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },
  // plusieurs réponses possibles, une seule pourra être choisie
  choices: {
    type: [ChoiceSchema],
    validate: {
      validator: (list) => list.length >= 2,
      message: 'une question doit proposer au moins 2 réponses'
    }
  }
});

const Schema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  // 1 ou plusieurs questions
  questions: {
    type: [QuestionSchema],
    validate: {
      validator: (list) => list.length >= 1,
      message: 'un sondage doit contenir au moins une question'
    }
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, options('polls'));

Schema.index({ event: 1 });

export default Schema;
