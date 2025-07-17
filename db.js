const mongoose = require('mongoose');

const mongoURI=process.env.MONGO_URI

const connectToMongo = async() =>{
    try{
        await mongoose.connect(mongoURI);
        console.log("Connected to mongo successfully!")
    }catch(error){
        console.error("Failed to connect to mongo:", error);
    }
}

module.exports=connectToMongo;