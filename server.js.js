const express = require('express');
const app = express();
app.use(express.json());

// GET request ke liye (Browser mein show karne ke liye)
app.get('/check', (req, res) => {
    res.send("Server is running and waiting for module request.");
});

// POST request ke liye (Module yahan data bhejega)
app.post('/check', (req, res) => {
    // Module ka data yahan receive hoga
    console.log("Data received:", req.body);
    
    res.json({
        active: true,
        lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjoic3VjY2VzcyJ9.signature_code",
        expiresAt: 2524608000000,
        reason: "ok"
    });
});

app.listen(3000, () => console.log("Server chal raha hai"));
