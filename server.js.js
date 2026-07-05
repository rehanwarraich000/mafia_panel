const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Data memory mein rahega (Server restart pe wipe hoga)
let licenses = { "R8YXC04WHNM": { days: 30 } };

app.get('/panel', (req, res) => {
    let html = '<h1>Panel</h1><ul>';
    for (let s in licenses) { html += `<li>${s} - ${licenses[s].days} days</li>`; }
    res.send(html + '</ul><form method="POST" action="/add"><input name="serial" placeholder="Serial" required><input name="days" placeholder="Days" required><button>Add</button></form>');
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

app.listen(process.env.PORT || 3000);
