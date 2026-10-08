const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");

const {
    BedrockRuntimeClient,
    ConverseCommand
} = require("@aws-sdk/client-bedrock-runtime");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));


// ============================================
// IMAGE UPLOAD
// ============================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 5 * 1024 * 1024
    }
});


// ============================================
// AWS BEDROCK
// ============================================

const bedrock = new BedrockRuntimeClient({
    region: "us-west-2"
});


// ============================================
// DONATION STORAGE
// ============================================

let donations = [];


// ============================================
// IMPACT DATA
// ============================================

let impact = {

    totalDonations: 0,

    rescuedDonations: 0,

    servingsRescued: 0

};


// ============================================
// SERVER STATUS
// ============================================

app.get("/api/status", (req, res) => {

    res.json({

        message:
            "EcoRescue server is running"

    });

});


// ============================================
// AI FOOD ANALYSIS
// ============================================

async function analyzeFood(
    imageBuffer,
    foodDescription
) {

    // Convert uploaded image to JPEG
    const jpegBuffer =
        await sharp(imageBuffer)
            .jpeg()
            .toBuffer();


    const prompt = `

You are EcoRescue, an AI assistant helping reduce food waste.

Analyze the food image and the donor's description.

Donor description:

${foodDescription || "No description provided"}


Return ONLY valid JSON in this exact structure:

{
  "foodIdentified": "short food name",
  "foodCategory": "Cooked / Fresh / Packaged / Bakery / Other",
  "rescuePriority": "HIGH / MEDIUM / LOW",
  "recommendedAction": "short practical recommendation",
  "safetyReminder": "short safety reminder"
}


Rules:

- Do not invent exact quantities.
- Do not claim that food is definitely safe to eat.
- If storage or handling information is unknown, say that the donor should confirm safe storage and handling.
- Keep every value short and practical.

`;


    const command =
        new ConverseCommand({

            modelId:
                "us.amazon.nova-pro-v1:0",

            messages: [

                {

                    role: "user",

                    content: [

                        {
                            text: prompt
                        },

                        {

                            image: {

                                format: "jpeg",

                                source: {

                                    bytes:
                                        jpegBuffer

                                }

                            }

                        }

                    ]

                }

            ],

            inferenceConfig: {

                maxTokens: 300,

                temperature: 0.2

            }

        });


    const response =
        await bedrock.send(command);


    const text =
        response.output.message.content

            .map(
                item =>
                    item.text || ""
            )

            .join("");


    // Remove possible markdown JSON formatting

    const cleaned =
        text

            .replace(
                /```json/gi,
                ""
            )

            .replace(
                /```/g,
                ""
            )

            .trim();


    return JSON.parse(cleaned);

}


// ============================================
// CREATE FOOD DONATION
// ============================================

app.post(

    "/api/donation",

    upload.single("image"),

    async (req, res) => {

        try {

            const {

                food,

                quantity,

                foodType,

                preparedTime,

                pickupDeadline,

                pickupLocation

            } = req.body;


            // Validate required fields

            if (

                !food ||

                !quantity ||

                !foodType ||

                !preparedTime ||

                !pickupDeadline ||

                !pickupLocation

            ) {

                return res.status(400).json({

                    error:
                        "Please provide all required information."

                });

            }


            // Default AI analysis

            let aiAnalysis = {

                foodIdentified:
                    food,

                foodCategory:
                    foodType,

                rescuePriority:
                    "MEDIUM",

                recommendedAction:
                    "Find a nearby receiver organization for pickup.",

                safetyReminder:
                    "Confirm safe food handling and storage before donation."

            };


            // Analyze image with Nova Pro

            if (req.file) {

                aiAnalysis =
                    await analyzeFood(

                        req.file.buffer,

                        food

                    );

            }


            // Create donation

            const donation = {

                id:
                    Date.now(),

                food:
                    food,

                quantity:
                    Number(quantity),

                foodType:
                    foodType,

                preparedTime:
                    preparedTime,

                pickupDeadline:
                    pickupDeadline,

                pickupLocation:
                    pickupLocation,

                status:
                    "Available",

                priority:
                    aiAnalysis.rescuePriority,

                aiAnalysis:
                    aiAnalysis

            };


            // Store donation

            donations.push(donation);


            // Update impact

            impact.totalDonations += 1;

            impact.servingsRescued +=
                donation.quantity;


            console.log(
                "\nNew AI-analyzed donation:"
            );

            console.log(donation);


            res.json({

                success:
                    true,

                message:
                    "Food analyzed by Nova Pro and donation posted successfully.",

                donation:
                    donation

            });


        }

        catch (error) {

            console.error(
                "\nBedrock error:",
                error
            );


            res.status(500).json({

                error:
                    "Unable to analyze the food with AI.",

                details:
                    error.message

            });

        }

    }

);


// ============================================
// GET AVAILABLE DONATIONS
// ============================================

app.get(
    "/api/donations",
    (req, res) => {

        const availableDonations =
            donations.filter(

                donation =>
                    donation.status ===
                    "Available"

            );


        res.json(
            availableDonations
        );

    }
);


// ============================================
// ACCEPT DONATION
// ============================================

app.post(

    "/api/donation/:id/accept",

    (req, res) => {

        const id =
            Number(req.params.id);


        const donation =
            donations.find(

                item =>
                    item.id === id

            );


        if (!donation) {

            return res.status(404).json({

                error:
                    "Donation not found."

            });

        }


        if (
            donation.status !==
            "Available"
        ) {

            return res.status(400).json({

                error:
                    "This donation is no longer available."

            });

        }


        // Mark as accepted

        donation.status =
            "Accepted";


        // Update rescued count

        impact.rescuedDonations += 1;


        console.log(
            "\nFood rescue accepted:"
        );

        console.log(donation);


        res.json({

            success:
                true,

            message:
                "Donation accepted successfully.",

            donation:
                donation

        });

    }

);


// ============================================
// IMPACT DASHBOARD API
// ============================================

app.get(
    "/api/impact",
    (req, res) => {


        /*
           This is an illustrative estimate
           for the hackathon prototype.

           We estimate 0.25 kg of food
           per rescued serving.
        */

        const estimatedWastePreventedKg =
            impact.servingsRescued * 0.25;


        res.json({

            totalDonations:
                impact.totalDonations,

            rescuedDonations:
                impact.rescuedDonations,

            servingsRescued:
                impact.servingsRescued,

            estimatedWastePreventedKg:
                Number(
                    estimatedWastePreventedKg
                        .toFixed(2)
                )

        });

    }
);


// ============================================
// START SERVER
// ============================================

const PORT = 5000;


app.listen(

    PORT,

    () => {

        console.log(
            `EcoRescue server running at http://localhost:${PORT}`
        );

    }

);