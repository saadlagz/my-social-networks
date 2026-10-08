const profile = {
  firstname: { type: 'name', required: true },
  lastname: { type: 'name', required: true },
  avatar: { type: 'url', nullable: true },
  bio: { type: 'string', max: 500, nullable: true },
  birthdate: { type: 'date', past: true, nullable: true }
};

export default {
  register: {
    ...profile,
    email: { type: 'email', required: true },
    password: { type: 'password', required: true }
  },
  login: {
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, trim: false, max: 72 }
  },
  // PATCH /users/me : changer de mot de passe demande l'ancien (current_password)
  update: {
    ...profile,
    email: { type: 'email' },
    password: { type: 'password' },
    current_password: { type: 'string', trim: false, max: 72 }
  }
};
