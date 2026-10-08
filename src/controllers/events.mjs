import validate from '../utils/validate.mjs';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error.mjs';
import {
  paginate, queryBoolean, queryDate, queryId, queryString, searchRegex
} from '../utils/query.mjs';
import {
  PUBLIC_USER, checkUsersExist, isGroupAdmin, visibleEventsFilter, isOrganizer, isParticipant, loadEvent, loadGroup, sameUser,
  uniqueIds
} from '../utils/access.mjs';
import rules from '../validators/event.mjs';

const Events = class Events {
  constructor(app, { models, auth, config }) {
    this.app = app;
    this.models = models;
    this.Event = models.Event;
    this.auth = auth;
    this.config = config;

    this.run();
  }

  role(event, user) {
    if (isOrganizer(event, user)) return 'organizer';
    if (isParticipant(event, user)) return 'participant';
    return null;
  }

  async present(event, user) {
    await event.populate([
      { path: 'organizers', select: PUBLIC_USER },
      { path: 'participants', select: PUBLIC_USER },
      { path: 'group', select: 'name type icon' }
    ]);

    return {
      ...event.toJSON(),
      participants_count: event.participants.length,
      my_role: this.role(event, user)
    };
  }

  // règles qui portent sur plusieurs champs à la fois
  checkConsistency({ start_date: start, end_date: end, visibility, settings }) {
    if (end <= start) throw badRequest(['end_date doit être après start_date']);
    if (settings.ticketing && visibility !== 'public') {
      throw badRequest(['settings.ticketing : la billetterie est réservée aux événements publics']);
    }
  }

  // supprime tout ce qui dépend d'un événement (fil, albums, sondages, billetterie...)
  async deleteEventData(event) {
    const {
      Thread, Message, Album, Photo, PhotoComment, Poll, PollAnswer, TicketType, Ticket, ShoppingItem, Carpool
    } = this.models;
    const thread = await Thread.findOne({ event: event._id });
    const photos = await Photo.find({ event: event._id }).distinct('_id');
    const polls = await Poll.find({ event: event._id }).distinct('_id');

    if (thread) await Message.deleteMany({ thread: thread._id });
    await Thread.deleteMany({ event: event._id });
    await PhotoComment.deleteMany({ photo: { $in: photos } });
    await Photo.deleteMany({ event: event._id });
    await Album.deleteMany({ event: event._id });
    await PollAnswer.deleteMany({ poll: { $in: polls } });
    await Poll.deleteMany({ event: event._id });
    await Ticket.deleteMany({ event: event._id });
    await TicketType.deleteMany({ event: event._id });
    await ShoppingItem.deleteMany({ event: event._id });
    await Carpool.deleteMany({ event: event._id });
  }

  createEvent() {
    this.app.post('/events', this.auth.required, async (req, res) => {
      const { errors, value } = validate(req.body, rules.create);

      if (errors.length > 0) throw badRequest(errors);
      this.checkConsistency(value);

      const {
        invite_group_members: inviteGroupMembers, organizers, participants, ...data
      } = value;
      let groupMembers = [];

      if (value.group) {
        const group = await loadGroup(this.models, value.group, req.user, 'member');

        if (!group.allow_member_events && !isGroupAdmin(group, req.user)) {
          throw forbidden('dans ce groupe, seuls les administrateurs peuvent créer des événements');
        }

        if (inviteGroupMembers) groupMembers = group.members;
      } else if (inviteGroupMembers) {
        throw badRequest(['invite_group_members nécessite un groupe']);
      }

      await checkUsersExist(this.models.User, organizers, 'organizers');
      await checkUsersExist(this.models.User, participants, 'participants');

      // le créateur est organisateur, et tous les organisateurs sont participants
      const allOrganizers = uniqueIds([req.user._id, ...organizers]);
      const event = await this.Event.create({
        ...data,
        organizers: allOrganizers,
        participants: uniqueIds([...allOrganizers, ...participants, ...groupMembers]),
        created_by: req.user._id
      });

      // chaque événement a son fil de discussion
      await this.models.Thread.create({ event: event._id });

      res.status(201).json(await this.present(event, req.user));
    });
  }

  getEvents() {
    this.app.get('/events', this.auth.optional, async (req, res) => {
      const search = queryString(req.query, 'search');
      const from = queryDate(req.query, 'from');
      const to = queryDate(req.query, 'to');
      const group = queryId(req.query, 'group');
      const mine = queryBoolean(req.query, 'mine');
      const me = req.user?._id;
      // un événement privé n'apparaît que pour ses participants, celui d'un groupe privé ou secret que pour ses membres
      const filters = [await visibleEventsFilter(this.models, req.user)];

      if (search) filters.push({ $or: [{ name: searchRegex(search) }, { location: searchRegex(search) }] });
      // événements qui ne sont pas terminés avant "from" et qui commencent avant "to"
      if (from) filters.push({ end_date: { $gte: from } });
      if (to) filters.push({ start_date: { $lte: to } });
      if (group) filters.push({ group });

      if (mine) {
        if (!me) throw badRequest(['le paramètre mine nécessite d\'être connecté']);
        filters.push({ participants: me });
      }

      res.status(200).json(await paginate(this.Event, { $and: filters }, req.query, {
        sort: { start_date: 1 },
        select: '-participants'
      }));
    });
  }

  getEventById() {
    this.app.get('/events/:id', this.auth.optional, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);

      res.status(200).json(await this.present(event, req.user));
    });
  }

  updateEvent() {
    this.app.patch('/events/:id', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');
      const { errors, value } = validate(req.body, rules.update, { partial: true });

      if (errors.length > 0) throw badRequest(errors);
      if (Object.keys(value).length === 0) throw badRequest(['aucun champ modifiable envoyé']);

      // on ne modifie que les réglages envoyés, ex : { settings: { carpooling: true } }
      if (value.settings) value.settings = { ...event.settings.toObject(), ...value.settings };

      const next = { ...event.toObject(), ...value };

      this.checkConsistency(next);

      if (event.settings.ticketing && !next.settings.ticketing && await this.models.Ticket.exists({ event: event._id })) {
        throw conflict('des billets ont déjà été vendus : la billetterie ne peut plus être désactivée');
      }

      event.set(value);
      await event.save();

      res.status(200).json(await this.present(event, req.user));
    });
  }

  deleteEvent() {
    this.app.delete('/events/:id', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');

      await this.deleteEventData(event);
      await event.deleteOne();

      res.status(200).json(event);
    });
  }

  getParticipants() {
    this.app.get('/events/:id/participants', this.auth.optional, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);

      await event.populate({ path: 'participants', select: PUBLIC_USER });

      res.status(200).json(event.participants.map((user) => ({
        ...user.toJSON(),
        role: isOrganizer(event, user) ? 'organizer' : 'participant'
      })));
    });
  }

  addParticipants() {
    this.app.post('/events/:id/participants', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');
      const { errors, value } = validate(req.body, rules.participants);

      if (errors.length > 0) throw badRequest(errors);

      await checkUsersExist(this.models.User, value.user_ids);

      event.participants.addToSet(...value.user_ids);
      if (value.role === 'organizer') event.organizers.addToSet(...value.user_ids);
      await event.save();

      res.status(200).json(await this.present(event, req.user));
    });
  }

  joinEvent() {
    this.app.post('/events/:id/join', this.auth.required, async (req, res) => {
      // un événement privé est introuvable pour un non-participant : loadEvent renvoie déjà 404
      const event = await loadEvent(this.models, req.params.id, req.user);

      if (isParticipant(event, req.user)) throw conflict('vous participez déjà à cet événement');

      event.participants.addToSet(req.user._id);
      await event.save();

      res.status(200).json(await this.present(event, req.user));
    });
  }

  // invite tous les membres du groupe de l'événement en un clic
  inviteGroup() {
    this.app.post('/events/:id/invite-group', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');

      if (!event.group) throw conflict('cet événement n\'est pas lié à un groupe');

      // l'organisateur doit être membre du groupe : sinon il pourrait récupérer la liste des membres d'un groupe privé
      const group = await loadGroup(this.models, event.group, req.user, 'member');
      const before = event.participants.length;

      event.participants.addToSet(...group.members);
      await event.save();

      res.status(200).json({
        invited: event.participants.length - before,
        event: await this.present(event, req.user)
      });
    });
  }

  updateParticipantRole() {
    this.app.patch('/events/:id/participants/:userId', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');
      const { userId } = req.params;
      const { errors, value } = validate(req.body, rules.role);

      if (errors.length > 0) throw badRequest(errors);
      if (!isParticipant(event, userId)) throw notFound('Participant');

      if (value.role === 'organizer') {
        event.organizers.addToSet(userId);
      } else {
        if (isOrganizer(event, userId) && event.organizers.length === 1) {
          throw conflict('l\'événement doit garder au moins un organisateur');
        }
        event.organizers.pull(userId);
      }

      await event.save();

      res.status(200).json(await this.present(event, req.user));
    });
  }

  removeParticipant() {
    this.app.delete('/events/:id/participants/:userId', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');
      const { userId } = req.params;

      // un participant peut se désinscrire, un organisateur peut retirer n'importe qui
      if (!sameUser(userId, req.user) && !isOrganizer(event, req.user)) {
        throw forbidden('seul un organisateur peut retirer un autre participant');
      }
      if (!isParticipant(event, userId)) throw notFound('Participant');
      if (isOrganizer(event, userId) && event.organizers.length === 1) {
        throw conflict('le dernier organisateur ne peut pas quitter l\'événement : nommez un autre organisateur');
      }

      event.participants.pull(userId);
      event.organizers.pull(userId);
      await event.save();

      // il ne fait plus partie de l'événement : on libère sa place en covoiturage et ce qu'il apportait
      const { Carpool, ShoppingItem } = this.models;

      await Carpool.updateMany({ event: event._id }, { $pull: { passengers: userId } });
      await Carpool.deleteMany({ event: event._id, driver: userId });
      await ShoppingItem.deleteMany({ event: event._id, user: userId });

      res.status(200).json(await this.present(event, req.user));
    });
  }

  // liens de partage vers les autres réseaux sociaux
  shareEvent() {
    this.app.get('/events/:id/share', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');

      if (event.visibility !== 'public') throw forbidden('seuls les événements publics peuvent être partagés');

      if (event.group) {
        const group = await this.models.Group.findById(event.group);

        if (group && group.type !== 'public') {
          throw forbidden('les événements d\'un groupe privé ou secret ne peuvent pas être partagés');
        }
      }

      const url = `${this.config.publicUrl}/events/${event._id}`;
      const text = `${event.name} - ${event.start_date.toISOString().slice(0, 10)} - ${event.location}`;
      const u = encodeURIComponent(url);
      const t = encodeURIComponent(text);

      res.status(200).json({
        url,
        text,
        links: {
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
          x: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
          linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
          whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
          email: `mailto:?subject=${t}&body=${u}`
        }
      });
    });
  }

  getEventThread() {
    this.app.get('/events/:id/thread', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');
      const thread = await this.models.Thread.findOne({ event: event._id });

      if (!thread) throw notFound('Thread');

      res.status(200).json(thread);
    });
  }

  run() {
    this.createEvent();
    this.getEvents();
    this.getEventById();
    this.updateEvent();
    this.deleteEvent();
    this.getParticipants();
    this.addParticipants();
    this.joinEvent();
    this.inviteGroup();
    this.updateParticipantRole();
    this.removeParticipant();
    this.shareEvent();
    this.getEventThread();
  }
};

export default Events;
