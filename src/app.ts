import express from 'express';
import dotenv from 'dotenv';
import webhookRouter from './routes/webhook.route';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use('/api/webhooks', webhookRouter);
app.get('/health', (req, res) => {
    res.json({
        status: 'up',
        time: new Date().toISOString(),
    });
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server ready at http://localhost:${port}`);
        console.log(`Hook path: POST /api/webhooks/billbee`);
    });
}

export default app;