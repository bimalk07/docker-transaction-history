// Import necessary modules
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');

// 🔧 Prometheus monitoring
const client = require('prom-client');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/transactionhistory';

// Prometheus metrics setup
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom HTTP request counter
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path'],
});
register.registerMetric(httpRequestCounter);

// MongoDB Schema
const transactionSchema = new mongoose.Schema({
  type: String,
  amount: Number,
  balance: Number,
  timestamp: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('MongoDB connected');
})
.catch(err => {
  console.error('Error connecting to MongoDB:', err);
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Prometheus middleware to count all requests
app.use((req, res, next) => {
  httpRequestCounter.inc({ method: req.method, path: req.path });
  next();
});

// HTML routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'styles.css'));
});

// API routes
app.post('/credit', async (req, res) => {
  const { amount } = req.body;
  if (amount < 0) return res.status(400).send('Please enter a valid amount');

  try {
    const newTransaction = new Transaction({ type: 'Credit', amount });
    await newTransaction.save();

    const transactions = await Transaction.find();
    const totalCredit = transactions.reduce((acc, curr) => curr.type === 'Credit' ? acc + curr.amount : acc, 0);
    const totalDebit = transactions.reduce((acc, curr) => curr.type === 'Debit' ? acc + curr.amount : acc, 0);
    const totalBalance = totalCredit - totalDebit;

    newTransaction.balance = totalBalance;
    await newTransaction.save();

    res.send(`Credit successful. Amount: ${amount}`);
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

app.post('/debit', async (req, res) => {
  const { amount } = req.body;
  if (amount < 0) return res.status(400).send('Please enter a valid amount');

  try {
    const transactions = await Transaction.find();
    const totalCredit = transactions.reduce((acc, curr) => curr.type === 'Credit' ? acc + curr.amount : acc, 0);
    const totalDebit = transactions.reduce((acc, curr) => curr.type === 'Debit' ? acc + curr.amount : acc, 0);
    const totalBalance = totalCredit - totalDebit;

    if (amount > totalBalance) {
      res.status(400).send('Insufficient balance');
    } else {
      const newTransaction = new Transaction({ type: 'Debit', amount });
      await newTransaction.save();

      newTransaction.balance = totalBalance - amount;
      await newTransaction.save();

      res.send(`Debit successful. Amount: ${amount}`);
    }
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

app.get('/balance', async (req, res) => {
  try {
    const transactions = await Transaction.find();
    const latestTransaction = transactions[transactions.length - 1];
    const balance = latestTransaction ? latestTransaction.balance : 0;
    res.send(`Total Balance: ${balance}`);
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

app.get('/history', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ timestamp: 'desc' });
    res.json(transactions);
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).send('Could not get metrics');
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
