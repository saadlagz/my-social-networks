import bcrypt from 'bcryptjs';
import validator from 'validator';

import validate from '../utils/validate.mjs';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error.mjs';
import { paginate, queryString, searchRegex } from '../utils/query.mjs';
import { PUBLIC_USER } from '../utils/access.mjs';
import rules from '../validators/user.mjs';

const Users = class Users {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.User = models.User;
    this.auth = auth;

    this.run();
  }

  // recherche d'utilisateurs, ex : pour les inviter dans un groupe ou un événement
  getUsers() {
    this.app.get('/users', this.auth.required, async (req, res) => {
      const search = queryString(req.query, 'search');
      const filter = {};

      if (search) {
        // on peut retrouver quelqu'un par son email exact, mais l'email n'est jamais renvoyé
        filter.$or = [
          { firstname: searchRegex(search) },
          { lastname: searchRegex(search) },
          { email: search.toLowerCase() }
        ];
      }

      res.status(200).json(await paginate(this.User, filter, req.query, {
        sort: { lastname: 1, firstname: 1 },
        select: `${PUBLIC_USER} bio`
      }));
    });
  }

  getUserById() {
    this.app.get('/users/:id', this.auth.required, async (req, res) => {
      const { id } = req.params;
      const user = validator.isMongoId(id) ? await this.User.findById(id).select(`${PUBLIC_USER} bio`) : null;

      if (!user) throw notFound('User');

      res.status(200).json(user);
    });
  }

  updateMe() {
    this.app.patch('/users/me', this.auth.required, async (req, res) => {
      const { errors, value } = validate(req.body, rules.update, { partial: true });

      if (errors.length > 0) throw badRequest(errors);

      const { current_password: currentPassword, ...update } = value;

      if (Object.keys(update).length === 0) throw badRequest(['aucun champ modifiable envoyé']);

      const user = await this.User.findById(req.user._id).select('+password');

      if (update.password !== undefined) {
        if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
          throw forbidden('current_password est requis et doit être correct pour changer de mot de passe');
        }

        update.password = await bcrypt.hash(update.password, 10);
      }

      if (update.email && update.email !== user.email && await this.User.exists({ email: update.email })) {
        throw conflict('un compte existe déjà avec cet email');
      }

      user.set(update);
      await user.save();

      res.status(200).json(user);
    });
  }

  deleteMe() {
    this.app.delete('/users/me', this.auth.required, async (req, res) => {
      const { Group, Event, Carpool, ShoppingItem } = this.models;
      const me = req.user._id;

      // un groupe ou un événement ne peut pas se retrouver sans administrateur / organisateur
      if (await Group.exists({ administrators: [me] }) || await Event.exists({ organizers: [me] })) {
        throw conflict('vous êtes le seul administrateur d\'un groupe ou le seul organisateur d\'un événement : '
          + 'nommez quelqu\'un d\'autre ou supprimez-le avant de supprimer votre compte');
      }

      await Group.updateMany({ members: me }, { $pull: { members: me, administrators: me } });
      await Event.updateMany({ participants: me }, { $pull: { participants: me, organizers: me } });
      await Carpool.updateMany({ passengers: me }, { $pull: { passengers: me } });
      await Carpool.deleteMany({ driver: me });
      await ShoppingItem.deleteMany({ user: me });
      await this.User.deleteOne({ _id: me });

      res.status(200).json(req.user);
    });
  }

  run() {
    this.getUsers();
    this.updateMe();
    this.deleteMe();
    this.getUserById();
  }
};

export default Users;
