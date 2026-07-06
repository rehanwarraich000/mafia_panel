const express = require('express');
const app = express();
app.use(express.json());

let licenses = { "R8YXC04WHNM": { days: 30 } }; // Apne serials yahan add karo

app.post('/check', (req, res) => {
    const serial = req.body.data ? req.body.data.serial : null;
    
    if (serial && licenses[serial]) {
        res.json({ 
            active: true, 
            lease: "TOKEN_VALID", 
            expiresAt: Date.now() + 2592000000, 
            reason: "ok" 
        });
    } else {
        res.json({ active: false, reason: "not_found" });
    }
});

app.listen(process.env.PORT || 3000);
