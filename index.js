const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.x0ux0.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// JWT middle tier/ middle layer:
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized Access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      // console.log({ err });
      return res.status(403).send({ message: "Forbidden Access" });
    }
    // console.log("verify user", { decoded });
    req.decoded = decoded;
    // console.log(req.decoded);
    next();
  });
}

async function run() {
  try {
    await client.connect();
    // console.log("db connected");
    // //All Collection:-----
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const usersCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");

    // Middle Layer For Verify admin:===
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await usersCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    };

    // To get All service provided by Doctor:----------
    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });
    //GET API for all users:---
    app.get("/user", verifyJWT, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // GET api for checking Admin or NOT: useAdmin.js hooks---
    app.get("/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      // console.log({ email });
      const user = await usersCollection.findOne({ email: email });
      // console.log(user);
      const isAdmin = user.role === "admin";

      res.send({ admin: isAdmin });
    });

    //PUT API to make User Admin:--------
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = { $set: { role: "admin" } };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send({ result });
    });

    // PUT Api for unique user and JWT toknassign for each users:--
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "24h" }
      );
      res.send({ result, token });
    });

    ////=== Make Api for Available time slot:---
    // warning :This is not the proper way to query multiple collection.
    // After learning MongoDb: use aggregate, lookup, pipeline,match, group.
    app.get("/available", async (req, res) => {
      const date = req.query.date;
      //== step 1: get all service
      const services = await serviceCollection.find().toArray();
      //== ste 2: get the bookings for the day. OutPut: [{},{},{},{}]
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      //== step 3: for each seervice
      services.forEach((service) => {
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        );
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map((book) => book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        //
        //step 7: set available to slots to make it easier
        service.slots = available;
      });
      res.send(services);
    });

    //// Api to get Booked patient Id
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        // const bookings = await bookingCollection.find({ patient }).toArray();
        return res.send(bookings);
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    });

    //POST Api for Booking on BookingModal:---
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exist = await bookingCollection.findOne(query);
      if (exist) {
        return res.send({ success: false, booking: exist });
      }
      const result = await bookingCollection.insertOne(booking);
      res.send({ success: true, result });
    });
    // GET API FOR all doctor information:
    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    });

    //POST API for doctor from AddDoctor.js:---------
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    // DELETE API FOR DOCTOR
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello From doctor Appointment");
});

app.listen(port, () => {
  console.log(`Doctor app listening on port ${port}`);
});

/**
 * API Naming Convension:===
 *
 * app.get('/booking') :> get allcollection or more then one or by query or by filter
 *
 * app.get('/booking/:id') :> Get A specific Booking
 *
 * app.post('/booking') :> TO add a new booking or create operation.
 *
 * app.patch('/booking/:id') :> Update a perticulat data
 *
 * app.delete('/booking/:id') :> delete a perticular data.
 * */
