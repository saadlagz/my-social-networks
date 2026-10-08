import validate from '../utils/validate.mjs';
import { badRequest, conflict } from '../utils/http-error.mjs';
import { paginate } from '../utils/query.mjs';
import { findById, loadEvent } from '../utils/access.mjs';
import rules from '../validators/ticket.mjs';

const Tickets = class Tickets {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.TicketType = models.TicketType;
    this.Ticket = models.Ticket;
    this.auth = auth;

    this.run();
  }

  // la billetterie n'existe que pour un événement public qui l'a activée
  checkTicketing(event) {
    if (event.visibility !== 'public' || !event.settings.ticketing) {
      throw conflict('la billetterie n\'est pas activée pour cet événement (settings.ticketing)');
    }
  }

  async loadTicketType(id, user, level) {
    const ticketType = await findById(this.TicketType, id, 'TicketType');
    const event = await loadEvent(this.models, ticketType.event, user, level);

    return { ticketType, event };
  }

  /* ---------- types de billets (organisateurs) ---------- */

  createTicketType() {
    this.app.post('/events/:id/ticket-types', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');

      this.checkTicketing(event);

      const { errors, value } = validate(req.body, rules.type);

      if (errors.length > 0) throw badRequest(errors);
      if (await this.TicketType.exists({ event: event._id, name: value.name })) {
        throw conflict('un type de billet porte déjà ce nom pour cet événement');
      }

      const ticketType = await this.TicketType.create({ ...value, event: event._id });

      res.status(201).json(ticketType);
    });
  }

  // public : une personne extérieure doit pouvoir voir les billets disponibles
  getTicketTypes() {
    this.app.get('/events/:id/ticket-types', this.auth.optional, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);

      this.checkTicketing(event);

      res.status(200).json(await this.TicketType.find({ event: event._id }).sort({ amount: 1 }));
    });
  }

  updateTicketType() {
    this.app.patch('/ticket-types/:id', this.auth.required, async (req, res) => {
      const { ticketType } = await this.loadTicketType(req.params.id, req.user, 'organizer');
      const { errors, value } = validate(req.body, rules.type, { partial: true });

      if (errors.length > 0) throw badRequest(errors);
      if (Object.keys(value).length === 0) throw badRequest(['aucun champ modifiable envoyé']);
      if (value.quantity !== undefined && value.quantity < ticketType.sold) {
        throw conflict(`${ticketType.sold} billets ont déjà été vendus : quantity ne peut pas être inférieure`);
      }
      if (value.name && value.name !== ticketType.name
        && await this.TicketType.exists({ event: ticketType.event, name: value.name })) {
        throw conflict('un type de billet porte déjà ce nom pour cet événement');
      }

      ticketType.set(value);
      await ticketType.save();

      res.status(200).json(ticketType);
    });
  }

  deleteTicketType() {
    this.app.delete('/ticket-types/:id', this.auth.required, async (req, res) => {
      const { ticketType } = await this.loadTicketType(req.params.id, req.user, 'organizer');

      if (ticketType.sold > 0) throw conflict('des billets de ce type ont déjà été vendus');

      await ticketType.deleteOne();

      res.status(200).json(ticketType);
    });
  }

  /* ---------- billets ---------- */

  // achat ouvert à tous, sans compte (personne extérieure)
  buyTicket() {
    this.app.post('/ticket-types/:id/tickets', async (req, res) => {
      const { ticketType, event } = await this.loadTicketType(req.params.id, null);

      this.checkTicketing(event);

      if (event.end_date < new Date()) throw conflict('cet événement est terminé');

      const { errors, value } = validate(req.body, rules.purchase);

      if (errors.length > 0) throw badRequest(errors);

      if (await this.Ticket.exists({ event: event._id, 'buyer.email': value.email })) {
        throw conflict('une personne ne peut obtenir qu\'un seul billet par événement');
      }

      // réservation atomique : deux achats simultanés ne peuvent pas dépasser la quantité
      const reserved = await this.TicketType.findOneAndUpdate(
        { _id: ticketType._id, $expr: { $lt: ['$sold', '$quantity'] } },
        { $inc: { sold: 1 } },
        { new: true }
      );

      if (!reserved) throw conflict('il n\'y a plus de billets disponibles pour ce type');

      try {
        const ticket = await this.Ticket.create({
          event: event._id,
          ticket_type: ticketType._id,
          amount: ticketType.amount,
          buyer: value
        });

        await ticket.populate({ path: 'ticket_type', select: 'name amount' });

        res.status(201).json(ticket);
      } catch (err) {
        // l'achat a échoué (ex : même email en même temps) : on rend la place
        await this.TicketType.updateOne({ _id: ticketType._id }, { $inc: { sold: -1 } });
        throw err;
      }
    });
  }

  getTickets() {
    this.app.get('/events/:id/tickets', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');

      res.status(200).json(await paginate(this.Ticket, { event: event._id }, req.query, {
        sort: { purchased_at: -1 },
        populate: { path: 'ticket_type', select: 'name amount' }
      }));
    });
  }

  // annulation d'un billet par un organisateur : la place est remise en vente
  cancelTicket() {
    this.app.delete('/tickets/:id', this.auth.required, async (req, res) => {
      const ticket = await findById(this.Ticket, req.params.id, 'Ticket');

      await loadEvent(this.models, ticket.event, req.user, 'organizer');

      await ticket.deleteOne();
      await this.TicketType.updateOne({ _id: ticket.ticket_type, sold: { $gt: 0 } }, { $inc: { sold: -1 } });

      res.status(200).json(ticket);
    });
  }

  run() {
    this.createTicketType();
    this.getTicketTypes();
    this.updateTicketType();
    this.deleteTicketType();
    this.buyTicket();
    this.getTickets();
    this.cancelTicket();
  }
};

export default Tickets;
