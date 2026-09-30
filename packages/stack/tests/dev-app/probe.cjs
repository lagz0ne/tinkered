module.exports = {
  clients: [],
  connections: [],
  signals: [],
  closed: [],
  entered: Promise.withResolvers(),
  release: Promise.withResolvers(),
  cleaned: 0,
  deliveries: 0,
  ticks: 0,
  timers: new Set(),
};
