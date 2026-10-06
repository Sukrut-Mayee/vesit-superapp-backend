require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const timetableRoutes = require('./routes/timetable');
const notesRoutes = require('./routes/notes');
const eventsRoutes = require('./routes/events');
const clubsRoutes = require('./routes/clubs');
const lostFoundRoutes = require('./routes/lost-found');
const internshipsRoutes = require('./routes/internships');
const placementRoutes = require('./routes/placement');
const resourcesRoutes = require('./routes/resources');
const borrowRequestsRoutes = require('./routes/borrow_requests');
const donationsRoutes = require('./routes/donations');
const announcementsRoutes = require('./routes/announcements');
const attendanceRoutes = require('./routes/attendance');

const app = express();

app.use(cors());
app.use(express.json());

// GET /health — Render uses this to confirm the service is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/timetable', timetableRoutes);
app.use('/notes', notesRoutes);
app.use('/events', eventsRoutes);
app.use('/clubs', clubsRoutes);
app.use('/lost-found', lostFoundRoutes);
app.use('/internships', internshipsRoutes);
app.use('/placement', placementRoutes);
app.use('/resources', resourcesRoutes);
app.use('/borrow-requests', borrowRequestsRoutes);
app.use('/donations', donationsRoutes);
app.use('/announcements', announcementsRoutes);
app.use('/attendance', attendanceRoutes);

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CampusOne backend listening on port ${PORT}`);
});
