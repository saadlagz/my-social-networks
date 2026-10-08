import validate from '../utils/validate.mjs';
import { badRequest, conflict } from '../utils/http-error.mjs';
import { paginate } from '../utils/query.mjs';
import { findById, loadEvent, toId } from '../utils/access.mjs';
import rules from '../validators/poll.mjs';

const Polls = class Polls {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.Poll = models.Poll;
    this.PollAnswer = models.PollAnswer;
    this.auth = auth;

    this.run();
  }

  async loadPoll(id, user, level) {
    const poll = await findById(this.Poll, id, 'Poll');
    const event = await loadEvent(this.models, poll.event, user, level);

    return { poll, event };
  }

  createPoll() {
    this.app.post('/events/:id/polls', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'organizer');
      const { errors, value } = validate(req.body, rules.poll);

      if (errors.length > 0) throw badRequest(errors);

      const poll = await this.Poll.create({ ...value, event: event._id, created_by: req.user._id });

      res.status(201).json(poll);
    });
  }

  getPolls() {
    this.app.get('/events/:id/polls', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');
      const result = await paginate(this.Poll, { event: event._id }, req.query, { sort: { created_at: -1 } });
      const answered = await this.PollAnswer.find({
        poll: { $in: result.data.map((poll) => poll._id) },
        user: req.user._id
      }).distinct('poll');
      const answeredIds = answered.map(toId);

      // answered : le participant connecté a-t-il déjà répondu ?
      result.data = result.data.map((poll) => ({ ...poll.toJSON(), answered: answeredIds.includes(toId(poll)) }));

      res.status(200).json(result);
    });
  }

  getPollById() {
    this.app.get('/polls/:id', this.auth.required, async (req, res) => {
      const { poll } = await this.loadPoll(req.params.id, req.user, 'participant');
      const answer = await this.PollAnswer.findOne({ poll: poll._id, user: req.user._id });

      res.status(200).json({ ...poll.toJSON(), my_answers: answer ? answer.answers : null });
    });
  }

  deletePoll() {
    this.app.delete('/polls/:id', this.auth.required, async (req, res) => {
      const { poll } = await this.loadPoll(req.params.id, req.user, 'organizer');

      await this.PollAnswer.deleteMany({ poll: poll._id });
      await poll.deleteOne();

      res.status(200).json(poll);
    });
  }

  answerPoll() {
    this.app.post('/polls/:id/answers', this.auth.required, async (req, res) => {
      const { poll } = await this.loadPoll(req.params.id, req.user, 'participant');
      const { errors, value } = validate(req.body, rules.answer);

      if (errors.length > 0) throw badRequest(errors);
      if (await this.PollAnswer.exists({ poll: poll._id, user: req.user._id })) {
        throw conflict('vous avez déjà répondu à ce sondage');
      }

      // chaque question du sondage doit avoir exactement une réponse, choisie parmi ses choix
      const answered = new Set();
      const answerErrors = [];

      value.answers.forEach(({ question, choice }) => {
        const found = poll.questions.id(question);

        if (!found) answerErrors.push(`la question ${question} n'existe pas dans ce sondage`);
        else if (answered.has(question)) answerErrors.push(`une seule réponse possible pour la question "${found.label}"`);
        else if (!found.choices.id(choice)) answerErrors.push(`le choix ${choice} n'existe pas pour la question "${found.label}"`);

        answered.add(question);
      });

      if (answerErrors.length === 0 && answered.size !== poll.questions.length) {
        answerErrors.push('il faut répondre à toutes les questions du sondage');
      }
      if (answerErrors.length > 0) throw badRequest(answerErrors);

      const answer = await this.PollAnswer.create({ poll: poll._id, user: req.user._id, answers: value.answers });

      res.status(201).json(answer);
    });
  }

  getResults() {
    this.app.get('/polls/:id/results', this.auth.required, async (req, res) => {
      const { poll } = await this.loadPoll(req.params.id, req.user, 'participant');

      // nombre de votes par choix, calculé par MongoDB
      const [votes, respondents] = await Promise.all([
        this.PollAnswer.aggregate([
          { $match: { poll: poll._id } },
          { $unwind: '$answers' },
          { $group: { _id: '$answers.choice', votes: { $sum: 1 } } }
        ]),
        this.PollAnswer.countDocuments({ poll: poll._id })
      ]);
      const count = new Map(votes.map((vote) => [toId(vote._id), vote.votes]));

      res.status(200).json({
        _id: poll._id,
        title: poll.title,
        respondents,
        questions: poll.questions.map((question) => ({
          _id: question._id,
          label: question.label,
          choices: question.choices.map((choice) => ({
            _id: choice._id,
            label: choice.label,
            votes: count.get(toId(choice)) || 0
          }))
        }))
      });
    });
  }

  run() {
    this.createPoll();
    this.getPolls();
    this.getPollById();
    this.deletePoll();
    this.answerPoll();
    this.getResults();
  }
};

export default Polls;
