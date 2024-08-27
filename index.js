const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const yahooFinance = require('yahoo-finance2').default;
const express = require('express');

// Initialize the Telegram bot with polling
const bot = new TelegramBot('7489061825:AAEUgxFsfhDLVgHUX5xbkMd7iancpB1RGEQ', {polling: true});

// Initialize SQLite database
let db = new sqlite3.Database('./tradingPlan.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the tradingPlan database.');
});

// Create the table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT,
    buy_area_min REAL,
    buy_area_max REAL,
    tp1_min REAL,
    tp1_max REAL,
    tp2_min REAL,
    tp2_max REAL,
    tp3_min REAL,
    tp3_max REAL,
    sl REAL,
    status TEXT,
    created_at TEXT
)`);

// Function to split ranges and get min/max
const getMinMax = (rangeStr) => {
    const [min, max] = rangeStr.split('-').map(Number);
    return { min, max };
};

// Handle incoming messages
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const message = msg.text;

    // Regular expressions to extract data
	const stockCodeRegex = /\$([A-Z]+(?:\.JK)?)/; // Updated to handle optional ".JK"
    const buyAreaRegex = /Buy Area:\n(\d+-\d+)/;
    const tpRegex = /Target Price:\n📈 (\d+-\d+), (\d+-\d+), (\d+-\d+)/;
    const slRegex = /SL (under|close under) (\d+)/;

    const stockCode = stockCodeRegex.exec(message)?.[1];
    const buyArea = buyAreaRegex.exec(message)?.[1];
    const tpMatches = tpRegex.exec(message);
    const tp1 = tpMatches?.[1];
    const tp2 = tpMatches?.[2];
    const tp3 = tpMatches?.[3];
    const slMatches = slRegex.exec(message);
    const sl = slMatches?.[2];

    // Extract min and max for Buy Area, TP1, TP2, TP3
    const buyAreaRange = getMinMax(buyArea);
    const tp1Range = getMinMax(tp1);
    const tp2Range = getMinMax(tp2);
    const tp3Range = getMinMax(tp3);

    if (stockCode && buyAreaRange && tp1Range && tp2Range && tp3Range && sl) {
        console.log('Extracted Data:', {
            stockCode, buyAreaRange, tp1Range, tp2Range, tp3Range, sl
        });

        db.run(`INSERT INTO plans (
            stock_code, 
            buy_area_min, buy_area_max, 
            tp1_min, tp1_max, 
            tp2_min, tp2_max, 
            tp3_min, tp3_max, 
            sl, 
            status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
                stockCode, 
                buyAreaRange.min, buyAreaRange.max, 
                tp1Range.min, tp1Range.max, 
                tp2Range.min, tp2Range.max, 
                tp3Range.min, tp3Range.max, 
                sl, 'active'
            ], 
            function(err) {
                if (err) {
                    return console.log('Database Insertion Error:', err.message);
                }
                bot.sendMessage(chatId, `Trading plan for ${stockCode} saved successfully.`);
            }
        );
    } else {
        bot.sendMessage(chatId, 'Failed to extract trading plan data. Please check the format.');
    }
});

// Function to check prices against the stored trading plans
const checkPrices = async () => {
    db.each(`SELECT * FROM plans WHERE status IN ('active', 'TP1 hit', 'TP2 hit', 'TP3 hit')`, async (err, row) => {
        if (err) {
            console.error(err.message);
            return;
        }

        try {
            // Append ".JK" to the stock code
            const stockCodeWithSuffix = row.stock_code.endsWith('.JK') ? row.stock_code : `${row.stock_code}.JK`;

            // Fetch the current stock price using yahoo-finance2
            const quote = await yahooFinance.quote(stockCodeWithSuffix);
            const currentPrice = quote.regularMarketPrice;

            console.log(`Current price for ${stockCodeWithSuffix}: ${currentPrice}`);

            let newStatus = row.status;

            if (currentPrice >= row.tp3_min && currentPrice <= row.tp3_max) {
                if (row.status !== 'TP3 hit') {
                    newStatus = 'TP3 hit';
                    bot.sendMessage('-1002187828659', `Plan ${row.stock_code} status: TP3 hit`);
                }
            } else if (currentPrice >= row.tp2_min && currentPrice <= row.tp2_max) {
                if (row.status !== 'TP2 hit') {
                    newStatus = 'TP2 hit';
                    bot.sendMessage('-1002187828659', `Plan ${row.stock_code} status: TP2 hit`);
                }
            } else if (currentPrice >= row.tp1_min && currentPrice <= row.tp1_max) {
                if (row.status !== 'TP1 hit') {
                    newStatus = 'TP1 hit';
                    bot.sendMessage('-1002187828659', `Plan ${row.stock_code} status: TP1 hit`);
                }
            } else if (currentPrice <= row.sl) {
                if (row.status.startsWith('TP')) {
                    newStatus = `SL (${row.status})`;
                } else {
                    newStatus = 'SL hit';
                }
                bot.sendMessage('-1002187828659', `Plan ${row.stock_code} status: ${newStatus}`);
            }

            if (newStatus !== row.status) {
                updatePlanStatus(row.id, newStatus);
            }
        } catch (error) {
            console.error(`Error fetching price for ${row.stock_code}:`, error);
        }
    });
};


// Function to update the status of a trading plan and send a notification
const updatePlanStatus = (id, status) => {
    db.run(`UPDATE plans SET status = ? WHERE id = ?`, [status, id], function(err) {
        if (err) {
            return console.error(err.message);
        }
        console.log(`Plan ${id} updated with status: ${status}`);

        // Send a Telegram alert
        bot.sendMessage('-1002187828659', `Plan ${id} status: ${status}`);
    });
};

// Schedule the price check to run periodically (e.g., every minute)
setInterval(checkPrices, 10000); // Check every minute

// Start the Express server (if needed for other purposes, optional)
const app = express();
app.listen(3000, () => {
    console.log('Server running on port 3000');
});
