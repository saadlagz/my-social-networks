import validate from '../utils/validate.mjs';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error.mjs';
import { paginate, queryBoolean, queryString, searchRegex } from '../utils/query.mjs';
import {
  PUBLIC_USER, canReadGroup, checkUsersExist, isGroupAdmin, isGroupMember, loadGroup, sameUser, toId,
  visibleEventsFilter
} from '../utils/access.mjs';
import { GROUP_TYPES } from '../models/group.mjs';
import rules from '../validators/group.mjs';

const Groups = class Groups {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.Group = models.Group;
    this.auth = auth;

    this.run();
  }

  // rôle de l'utilisateur connecté dans le groupe : admin, member ou null
  role(group, user) {
    if (isGroupAdmin(group, user)) return 'admin';
    if (isGroupMember(group, user)) return 'member';
    return null;
  }

  // les membres d'un groupe privé ou secret ne sont visibles que par ses membres
  async present(group, user) {
    const json = group.toJSON();

    json.members_count = group.members.length;
    json.my_role = this.role(group, user);

    if (canReadGroup(group, user)) {
      await group.populate([
        { path: 'administrators', select: PUBLIC_USER },
        { path: 'members', select: PUBLIC_USER }
      ]);
      json.administrators = group.administrators;
      json.members = group.members;
    } else {
      delete json.administrators;
      delete json.members;
    }

    return json;
  }

  createGroup() {
    this.app.post('/groups', this.auth.required, async (req, res) => {
      const { errors, value } = validate(req.body, rules.group);

      if (errors.length > 0) throw badRequest(errors);

      const me = req.user._id;
      const group = await this.Group.create({
        ...value,
        administrators: [me],
        members: [me],
        created_by: me
      });

      // chaque groupe a son fil de discussion
      await this.models.Thread.create({ group: group._id });

      res.status(201).json(await this.present(group, req.user));
    });
  }

  getGroups() {
    this.app.get('/groups', this.auth.optional, async (req, res) => {
      const search = queryString(req.query, 'search');
      const type = queryString(req.query, 'type');
      const mine = queryBoolean(req.query, 'mine');
      const me = req.user?._id;
      // un groupe secret n'apparaît que pour ses membres
      const filters = [me ? { $or: [{ type: { $ne: 'secret' } }, { members: me }] } : { type: { $ne: 'secret' } }];

      if (type !== undefined) {
        if (!GROUP_TYPES.includes(type)) throw badRequest([`le paramètre type doit valoir ${GROUP_TYPES.join(', ')}`]);
        filters.push({ type });
      }

      if (search) filters.push({ name: searchRegex(search) });

      if (mine) {
        if (!me) throw badRequest(['le paramètre mine nécessite d\'être connecté']);
        filters.push({ members: me });
      }

      res.status(200).json(await paginate(this.Group, { $and: filters }, req.query, {
        sort: { created_at: -1 },
        select: '-members -administrators'
      }));
    });
  }

  getGroupById() {
    this.app.get('/groups/:id', this.auth.optional, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);

      res.status(200).json(await this.present(group, req.user));
    });
  }

  updateGroup() {
    this.app.patch('/groups/:id', this.auth.required, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user, 'admin');
      const { errors, value } = validate(req.body, rules.group, { partial: true });

      if (errors.length > 0) throw badRequest(errors);
      if (Object.keys(value).length === 0) throw badRequest(['aucun champ modifiable envoyé']);

      group.set(value);
      await group.save();

      res.status(200).json(await this.present(group, req.user));
    });
  }

  deleteGroup() {
    this.app.delete('/groups/:id', this.auth.required, async (req, res) => {
      const { Thread, Message, Event } = this.models;
      const group = await loadGroup(this.models, req.params.id, req.user, 'admin');
      const thread = await Thread.findOne({ group: group._id });

      if (thread) {
        await Message.deleteMany({ thread: thread._id });
        await thread.deleteOne();
      }

      // les événements du groupe continuent d'exister, sans groupe
      await Event.updateMany({ group: group._id }, { $set: { group: null } });
      await group.deleteOne();

      res.status(200).json(group);
    });
  }

  getMembers() {
    this.app.get('/groups/:id/members', this.auth.optional, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user, 'read');

      await group.populate({ path: 'members', select: PUBLIC_USER });

      res.status(200).json(group.members.map((user) => ({
        ...user.toJSON(),
        role: isGroupAdmin(group, user) ? 'admin' : 'member'
      })));
    });
  }

  addMembers() {
    this.app.post('/groups/:id/members', this.auth.required, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user, 'admin');
      const { errors, value } = validate(req.body, rules.members);

      if (errors.length > 0) throw badRequest(errors);

      await checkUsersExist(this.models.User, value.user_ids);

      group.members.addToSet(...value.user_ids);
      if (value.role === 'admin') group.administrators.addToSet(...value.user_ids);
      await group.save();

      res.status(200).json(await this.present(group, req.user));
    });
  }

  joinGroup() {
    this.app.post('/groups/:id/join', this.auth.required, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);

      if (isGroupMember(group, req.user)) throw conflict('vous êtes déjà membre de ce groupe');
      if (group.type !== 'public') throw forbidden('groupe privé : seul un administrateur peut vous ajouter');

      group.members.addToSet(req.user._id);
      await group.save();

      res.status(200).json(await this.present(group, req.user));
    });
  }

  updateMemberRole() {
    this.app.patch('/groups/:id/members/:userId', this.auth.required, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user, 'admin');
      const { userId } = req.params;
      const { errors, value } = validate(req.body, rules.role);

      if (errors.length > 0) throw badRequest(errors);
      if (!isGroupMember(group, userId)) throw notFound('Member');

      if (value.role === 'admin') {
        group.administrators.addToSet(userId);
      } else {
        if (isGroupAdmin(group, userId) && group.administrators.length === 1) {
          throw conflict('le groupe doit garder au moins un administrateur');
        }
        group.administrators.pull(userId);
      }

      await group.save();

      res.status(200).json(await this.present(group, req.user));
    });
  }

  removeMember() {
    this.app.delete('/groups/:id/members/:userId', this.auth.required, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user, 'member');
      const { userId } = req.params;

      // un membre peut quitter le groupe, un administrateur peut retirer n'importe qui
      if (!sameUser(userId, req.user) && !isGroupAdmin(group, req.user)) {
        throw forbidden('seul un administrateur peut retirer un autre membre');
      }
      if (!isGroupMember(group, userId)) throw notFound('Member');
      if (isGroupAdmin(group, userId) && group.administrators.length === 1) {
        throw conflict('le dernier administrateur ne peut pas quitter le groupe : nommez un autre administrateur');
      }

      group.members.pull(userId);
      group.administrators.pull(userId);
      await group.save();

      res.status(200).json(await this.present(group, req.user));
    });
  }

  getGroupEvents() {
    this.app.get('/groups/:id/events', this.auth.optional, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user, 'read');
      const filter = { $and: [{ group: group._id }, await visibleEventsFilter(this.models, req.user)] };

      res.status(200).json(await paginate(this.models.Event, filter, req.query, {
        sort: { start_date: 1 },
        select: '-participants'
      }));
    });
  }

  getGroupThread() {
    this.app.get('/groups/:id/thread', this.auth.required, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user, 'read');
      const thread = await this.models.Thread.findOne({ group: toId(group) });

      if (!thread) throw notFound('Thread');

      res.status(200).json(thread);
    });
  }

  run() {
    this.createGroup();
    this.getGroups();
    this.getGroupById();
    this.updateGroup();
    this.deleteGroup();
    this.getMembers();
    this.addMembers();
    this.joinGroup();
    this.updateMemberRole();
    this.removeMember();
    this.getGroupEvents();
    this.getGroupThread();
  }
};

export default Groups;
