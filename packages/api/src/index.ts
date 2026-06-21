import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import menuRoutes from './routes/menu';
import chatRoutes from './routes/chat';
import ordersRoutes from './routes/orders';
import inventoryRoutes from './routes/inventory';
import dashboardRoutes from './routes/dashboard';
import alertsRoutes from './routes/alerts';
import forecastRoutes from './routes/forecast';
import authRoutes from './routes/auth';
import posRoutes from './routes/pos';
import adminRoutes from './routes/superadmin';
import { startAlertScheduler } from './services/alerts';

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/menu', menuRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  startAlertScheduler();
});
