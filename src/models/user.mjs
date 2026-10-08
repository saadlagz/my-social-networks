import mongoose from 'mongoose';

import options from './options.mjs';

const Schema = new mongoose.Schema({
  firstname: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastname: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  // deux utilisateurs ne peuvent pas avoir le même email : index unique
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^\S+@\S+\.\S+$/
  },
  // hash bcrypt, jamais renvoyé : il faut le demander avec .select('+password')
  password: {
    type: String,
    required: true,
    select: false
  },
  avatar: String,
  bio: {
    type: String,
    maxlength: 500
  },
  birthdate: Date
}, options('users'));

Schema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    return ret;
  }
});

export default Schema;
