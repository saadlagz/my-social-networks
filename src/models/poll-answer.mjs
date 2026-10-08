import mongoose from 'mongoose';

import options from './options.mjs';

// les réponses d'un participant à un sondage : 1 choix par question
const Schema = new mongoose.Schema({
  poll: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Poll',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  answers: [{
    _id: false,
    question: { type: mongoose.Schema.Types.ObjectId, required: true },
    choice: { type: mongoose.Schema.Types.ObjectId, required: true }
  }]
}, options('poll_answers'));

// un participant ne répond qu'une fois à un sondage
Schema.index({ poll: 1, user: 1 }, { unique: true });

export default Schema;
