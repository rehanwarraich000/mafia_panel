const express = require('express');
const app = express();
app.use(express.json());

let licenses = { "R8YXC04WHNM": { days: 30 } }; // Apne serial yahan add karo

// Panel view
app.get('/panel', (req, res) => {
    res.send('<h1>Mafia Panel</h1><p>Server is Active</p>');
});

// Module request handler
app.post('/panel', (req, res) => {
    const serial = req.body.data ? req.body.data.serial : null;
    if (serial && licenses[serial]) {
        res.json({ 
            active: true, 
            lease: "OK", 
            expiresAt: Date.now() + (licenses[serial].days * 86400000) 
        });
    } else {
        res.json({ active: false });
    }
});

app.listen(process.env.PORT || 3000, '0.0.0.0');
