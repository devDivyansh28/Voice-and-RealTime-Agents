const VERCEL_API_KEY =
  "vercel_api_key"; // Replace with your Vercel AI Gateway API key

async function llm(userText) {
    if (!VERCEL_API_KEY || VERCEL_API_KEY === "YOUR_VERCEL_API_KEY") {
        console.warn("⚠️ Please set your VERCEL_API_KEY in script.js");
        return "Please set your VERCEL_API_KEY in script.js";
    }

    try {
        const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${VERCEL_API_KEY}`
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: userText
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Vercel AI Gateway error (${response.status}): ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const textOutput = data.choices?.[0]?.message?.content || "";
        return textOutput;
    } catch (error) {
        console.error("Error in llm function:", error);
        throw error;
    }
}

// Fallback using browser built-in SpeechSynthesis if cloud TTS fails or has no credits
function fallbackBrowserSpeak(text) {
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            console.warn("Browser does not support SpeechSynthesis.");
            resolve();
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = (e) => {
            console.error("SpeechSynthesis error:", e);
            resolve();
        };
        window.speechSynthesis.speak(utterance);
    });
}

// Async speak function: calls Vercel AI Gateway TTS endpoint (/v4/ai/speech)
async function speak(text) {
    try {
        const response = await fetch("https://ai-gateway.vercel.sh/v4/ai/speech", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${VERCEL_API_KEY}`,
                "ai-model-id": "openai/tts-1"
            },
            body: JSON.stringify({
                text: text,
                voice: "alloy",
                outputFormat: "mp3"
            })
        });

        if (!response.ok) {
            const err = await response.text().catch(() => "");
            throw new Error(`TTS API failed with status ${response.status}: ${err}`);
        }

        const contentType = response.headers.get("content-type") || "";
        let audioSrc;
        let isBlob = false;

        // Vercel AI Gateway TTS returns JSON with base64 audio
        if (contentType.includes("application/json")) {
            const json = await response.json();
            const base64 = json.audio?.base64 || json.audio || json.base64;
            const mediaType = json.audio?.mediaType || "audio/mpeg";

            if (!base64) {
                throw new Error("No audio payload returned from TTS: " + JSON.stringify(json));
            }
            audioSrc = `data:${mediaType};base64,${base64}`;
        } else {
            // Direct audio binary stream / blob
            const blob = await response.blob();
            audioSrc = URL.createObjectURL(blob);
            isBlob = true;
        }

        const audio = new Audio(audioSrc);

        console.log("🔊 AI is speaking via TTS...");

        // Play the audio and wait until playback finishes
        await new Promise((resolve, reject) => {
            audio.onended = () => {
                if (isBlob) URL.revokeObjectURL(audioSrc);
                resolve();
            };
            audio.onerror = (e) => {
                if (isBlob) URL.revokeObjectURL(audioSrc);
                reject(e);
            };
            audio.play().catch(reject);
        });

        console.log("✅ Finished speaking.");
    } catch (error) {
        console.warn("Cloud TTS API failed, falling back to browser SpeechSynthesis:", error.message);
        await fallbackBrowserSpeak(text);
    }
}

async function main() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        console.error("Speech Recognition API is not supported in this browser.");
        return;
    }

    const speechRecognition = new SpeechRecognition();

    speechRecognition.continuous = true;
    speechRecognition.interimResults = false;
    speechRecognition.maxAlternatives = 1;

    let isProcessing = false;

    speechRecognition.onstart = function () {
        console.log("🎤 Speech recognition started");
    };

    speechRecognition.onresult = async function (event) {
        if (isProcessing) return; // Prevent mic from processing while bot is replying

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
                const transcript = result[0].transcript.trim();
                console.log("User :", transcript);

                isProcessing = true;
                try {
                    // 1. Temporarily stop recognition so mic doesn't catch AI's own audio
                    try { speechRecognition.stop(); } catch (e) {}

                    // 2. Fetch LLM reply
                    const reply = await llm(transcript);
                    console.log("AI :", reply);

                    // 3. Play audio via TTS and await until done
                    await speak(reply);
                } catch (err) {
                    console.error("Pipeline error:", err);
                } finally {
                    isProcessing = false;
                    // 4. Revalidate / restart speech recognition so the user can speak again
                    try {
                        speechRecognition.start();
                        console.log("🎤 Listening again...");
                    } catch (e) {
                        // Ignore if already starting or active
                    }
                }
            }
        }
    };

    speechRecognition.onerror = function (event) {
        console.error("Speech recognition error:", event.error);
    };

    speechRecognition.start();
}

main();
