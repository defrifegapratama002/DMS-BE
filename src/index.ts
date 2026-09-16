import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { errorHandler } from './middlewares/errorHandler.js';
import logger from './utils/logger.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import folderRoutes from './routes/folderRoutes.js';
import shareRoutes from './routes/shareRoutes.js';
import activityLogRoutes from './routes/activityLogRoutes.js';
import userRoutes from './routes/userRoutes.js';
import metadataRoutes from './routes/metadataRoutes.js';

dotenv.config();

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL?.split(',') || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/metadata', metadataRoutes);


app.get('/healthz', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`🚀 DMS Backend running on http://localhost:${PORT}`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
});