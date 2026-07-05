const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Data memory mein rahega
let licenses = { "R8YXC04WHNM": { days: 30 } };

app.get('/panel', (req, res) => {
    let html = '<h1>Mafia Panel</h1><ul>';
    for (let s in licenses) { 
        html += `<li>${s} - ${licenses[s].days} days</li>`; 
    }
    res.send(html + '</ul><hr><form method="POST" action="/add"><input name="serial" placeholder="Serial" required><input name="days" placeholder="Days" required><button type="submit">Add/Update</button></form>');
});

app.post('/add', (req, res) => {
    licenses[req.body.serial] = { days: parseInt(req.body.days) };
    res.send("Added! <a href='/panel'>Back</a>");
});

app.post('/check', (req, res) => {
    const serial = req.body.data ? req.body.data.serial : null;
    if (serial && licenses[serial]) {
        res.json({ 
            active: true, 
            lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature", 
            expiresAt: Date.now() + (licenses[serial].days * 86400000), 
            reason: "ok" 
        });
    } else {
        res.json({ active: false, reason: "disabled" });
    }
});

// Render ke liye perfect Port binding
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
