import { Router } from 'express';
import { getForecast, getDishPortionsForecast } from '../services/forecast';
import { generateWeeklyReport } from '../services/report';

const router = Router();

// GET /api/forecast/:restaurantId — previsione scorte ingredienti
router.get('/:restaurantId', async (req, res) => {
  try {
    const forecast = await getForecast(req.params.restaurantId);
    res.json(forecast);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/forecast/:restaurantId/portions — porzioni ancora fattibili per piatto
router.get('/:restaurantId/portions', async (req, res) => {
  try {
    const portions = await getDishPortionsForecast(req.params.restaurantId);
    res.json(portions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/forecast/:restaurantId/report — scarica PDF settimanale
router.get('/:restaurantId/report', async (req, res) => {
  try {
    const pdf = await generateWeeklyReport(req.params.restaurantId);
    const filename = `report-${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

export default router;
