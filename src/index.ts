import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes.js';
import folderRoutes from './routes/folderRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import shareRoutes from './routes/shareRoutes.js';
import activityLogRoutes from './routes/activityLogRoutes.js';


const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/activity-logs', activityLogRoutes);

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'SecureDMS Backend API Running Securely' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
console.log(`🚀 Server berjalan dengan aman pada URL http://localhost:${PORT}`);
});