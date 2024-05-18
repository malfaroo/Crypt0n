const express = require('express'); 
const fs = require('fs'); 
const path = require('path'); 
const readline = require('readline'); 
const bodyParser = require('body-parser'); 
const dotenv = require('dotenv'); 

const { MongoClient, ObjectId} = require('mongodb');
const axios = require('axios'); 
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const passport = require('passport'); 
const LocalStrategy = require('passport-local'); 
const MongoStore = require('connect-mongo'); 
const { resourceLimits } = require('worker_threads');



dotenv.config();

const app = express(); 

//this will be for testing purposes but I belive the website 
//will not require a port number. 


//I want to have some sort of login form that uses usernames and 
//passwords so we will need to use bcrypt, along with something 
//called passport, express-session (geeksforgeeks
//https://www.geeksforgeeks.org/login-form-using-node-js-and-mongodb/#
//)
const portNumber = process.env.PORT || 4000; 

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri);



app.use(bodyParser.urlencoded({extended: true})); 
app.use(bodyParser.json()); 

app.set('view engine', 'ejs'); 
app.set('views', path.join(__dirname, 'templates'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session( {
    secret : '4l@7tok0PRusWOk$pacr', 
    resave : false, 
    saveUninitialized :false , 
    store : new MongoStore( {clientPromise : client.connect() } ) 
})); 

app.use(passport.initialize()); 
app.use(passport.session()); 

passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const db = client.db(process.env.MONGO_DB_NAME); 
        const user = await db.collection('Users').findOne( {username} ); 

        if(!user) {
            return done(null, false, {message : 'The username does not exist'}); 
        }

        const match = await bcrypt.compare(password, user.password); 
        if (match) {
            return done(null, user); 
        } else {
            return done(null, false, {message : 'Password is Inccorect. Try again.'} );
        }
    } catch (error) {
        return done(error); 
    }
})); 

passport.serializeUser((user, done) => {
    done(null, user._id); 
}); 

passport.deserializeUser(async (id, done ) => {
    try{
        const db = client.db(process.env.MONGO_DB_NAME); 
        const user = await db.collection('Users').findOne( {_id : new ObjectId(id)} )
        done(null, user);  
    }catch (error) {    
        done(error); 
    }
}); 


//copy and paste from previous project. 
const reading = readline.createInterface({
    input: process.stdin, 
    output: process.stdout,
    prompt: 'Stop to shutdown the server: '
}); 


reading.on('line', (line) => {
    switch (line.trim()) {
        case 'stop':
            console.log('Shutting down the server');
            reading.close(); 
            process.exit(0); 

        default:
            console.log(`Invalid command: ${line.trim()}`); 
            break; 
    }
    reading.prompt(); 
}).on('close', () => {process.exit(0);});

app.get('/', (req, res) => {
res.render('index', {user: req.user}); 
}); 

app.get('/Login', (req, res) => {
res.render('LoginAcc'); 
}); 

app.get('/Register', (req, res ) => {
res.render('CreateAcc'); 
}); 



app.post('/Register', async (req, res) => {
    const { username, password } = req.body; 
    try{

        //10 is the number of rounds. 
        const PassWHash = await bcrypt.hash(password, 10); 
        const db = client.db(process.env.MONGO_DB_NAME); 

        const findUser = await db.collection('Users').findOne( {username: username} ); 

        if(findUser) {
            return res.render('CreateAcc', 
            {message : "An account already exists, use a different username or Login."})
        }

        await db.collection('Users').insertOne( {username, password : PassWHash} ); 

        res.redirect('/Login'); 
    } catch (error) {
        console.error('There was an a error: ', error); 
        res.render('CreateAcc', {message : "There was an error with registering"}); 
    }
}); 

app.post('/Login', passport.authenticate('local', {
    successRedirect : '/', failureRedirect : '/Register' 
})) ; 

app.get('/Logout', (req, res) => {
    //I need a callback function. 
    req.session.destroy((error) => {
        if(error) {
            return console.log(error)
        }
        res.redirect('/Login');
    });
    
    
});

//List api that gets list of cryptos, will contain the crypto code (ex. BTC - BITCOIN)
app.post('/List', async(req, res ) => {
    try{
        const api = await axios.get('https://api.coinbase.com/v2/currencies/crypto');

        const datas = api.data.data; 

        res.render('Currencies', {datas}); 

    }catch(error ) {
        console.error('Could not fetch Cryptos, Error is: ', error ); 

        res.status(500).send('Could not fetch data'); 
    }
}); 

//here put in the other API for price 
app.post('/Track', async (req, res) => { 
    const cryptoCode = req.body.crypto_Name.toUpperCase(); 
    try{ 
        const url = 
        `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${cryptoCode}`;
        const datas = await axios.get(url, {
            //got from api documenation. 
            headers : {'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY
            }
        }) ; 

        const cryptoInfo = datas.data.data[cryptoCode]; 
        const cryptoPrice = cryptoInfo.quote.USD.price; 
        const name = cryptoInfo.name; 


        res.render('Price', {name, symbol: cryptoCode, cryptoPrice,
            user : req.user || null
         }); 
    }catch (error) {
        console.error('Failed to fetch crypto data here is the error: ', error); 
        res.status(500).send('Failed to fetch data from API'); 
    }
}); 


app.post('/Favorite', async (req, res ) => {
    if(!req.user ) {
        return res.status(403).send
        ( "This action could not be completed at this time, please Login");
    }

    const {cryptoSymbol } = req.body; 
    const username = req.user.username; 
    
    try {
        const db = client.db(process.env.MONGO_DB_NAME); 
        const ans = await db.collection('Users').updateOne(
            { username : username}, {$addToSet : {favorites : cryptoSymbol}}
        );

        if (ans.modifiedCount === 0 ) {
            res.send("This crypto is already in your favorites."); 
        } else {
            res.send("This crypto has been added to your list of favorites."); 
        }

    }catch (error) {
        console.error('Problem adding favorites ', error); 
        res.status(500).send('Failed to add your favorite'); 
    }
    
}); 

app.post('/RemoveALLFavorites', async (req, res ) => {
    if (!req.user) {
        return res.status(403).send
        ("This action could not be completed at this time");

    }
    const db = client.db(process.env.MONGO_DB_NAME); 
    await db.collection('Users').updateOne(
        {username : req.user.username }, {$set : {favorites : []}}
    ); 
    res.send( "ALL your favorites were removed!" ); 
}); 

app.post('/RemoveFavorite', async (req, res ) => {
    if (!req.user) {
        return res.status(403).send
        ("This action could not be completed at this time");

    }

    const {cryptoSymbol } = req.body; 


    const db = client.db(process.env.MONGO_DB_NAME); 
    try{
        const ans = await db.collection('Users').updateOne(
            {username : req.user.username} , {$pull : {favorites : cryptoSymbol}}
        ); 

        if(ans.modifiedCount === 0 ) {
            res.send("There were no changes made, weird");
        } else {
            res.send("Great! Favortie was removed"); 
        }

    }catch(error) {
        console.error('Problem when removing favorite ', error); 
        res.status(500).send('Failed to remove your favorite'); 
    }
}); 



app.get('/Favorites', async (req, res ) => {
    if (!req.user) { 
        return res.redirect('/Login'); 
    }

    try {
        const db = client.db(process.env.MONGO_DB_NAME); 

        const user = await db.collection('Users').findOne
        ( {username : req.user.username} ); 

        if(user ) {
            res.render('Favorites', {favorites : user.favorites || []}); 

        } else {
            res.status(404).send("The user was not found. "); 
        }

    }catch(error) {
        console.error('Problem getting data from database ', error); 
        res.status(500).send('Problem getting users data'); 
    }
}); 

//end 
app.listen(portNumber, () => {
    console.log(`Web server started and running at ${portNumber}`); 
    reading.prompt();
}); 