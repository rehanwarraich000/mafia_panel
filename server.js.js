const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

let db = { "DK030A95NEU006813": { status: "active", days: 30 } };

app.get('/check', (req, res) => {
    const serial = req.query.serial;
    res.json(db[serial] ? db[serial] : { status: "invalid" });
});

app.get('/panel', (req, res) => {
    let html = '<h1>License Panel</h1><ul>';
    for (let s in db) html += `<li>${s}: ${db[s].status} (${db[s].days} days) <a href="/toggle?serial=${s}">Toggle</a></li>`;
    res.send(html + '</ul><form action="/add" method="POST"><input name="serial" placeholder="Serial"> <input name="days" placeholder="Days" type="number"><button>Add</button></form>');
});

app.post('/add', (req, res) => {
    db[req.body.serial] = { status: "active", days: req.body.days };
    res.redirect('/panel');
});

app.get('/toggle', (req, res) => {
    const s = req.query.serial;
    db[s].status = db[s].status === "active" ? "disabled" : "active";
    res.redirect('/panel');
});

app.listen(3000, () => console.log('Server running on port 3000'));