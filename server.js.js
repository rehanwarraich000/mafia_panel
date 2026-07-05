const express = require('express');
const app = express();
app.use(express.json());

app.post('/check', (req, res) => {
    // Yahan serial check ka logic aayega
    res.json({
        active: true,
        lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjoic3VjY2VzcyJ9.signature_code",
        expiresAt: 2524608000000,
        reason: "ok"
    });
});

app.listen(3000, () => console.log("Server running"));
