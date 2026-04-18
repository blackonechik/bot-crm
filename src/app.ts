import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import rolesRoutes from './routes/roles.routes';
import clientsRoutes from './routes/clients.routes';
import chatsRoutes from './routes/chats.routes';
import leadsRoutes from './routes/leads.routes';
import faqRoutes from './routes/faq.routes';
import clinicRoutes from './routes/clinic.routes';
import scenariosRoutes from './routes/scenarios.routes';
import quizzesRoutes from './routes/quizzes.routes';
import appointmentsRoutes from './routes/appointments.routes';
import notificationsRoutes from './routes/notifications.routes';
import eventsRoutes from './routes/events.routes';
import analyticsRoutes from './routes/analytics.routes';
import integrationsRoutes from './routes/integrations.routes';
import webhooksRoutes from './routes/webhooks.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler, notFound } from './middlewares/error-handler';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/api', (_req, res) => {
  res.json({ name: 'bot-crm-backend', version: '0.1.0' });
});

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/faq', faqRoutes);
app.use('/api/clinic', clinicRoutes);
app.use('/api/scenarios', scenariosRoutes);
app.use('/api/quizzes', quizzesRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/webhooks', webhooksRoutes);

app.use(notFound);
app.use(errorHandler);
