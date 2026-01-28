
import { GoogleGenAI } from "@google/genai";

export const askSanghaAssistant = async (question: string): Promise<string> => {
  // Always initialize with the latest API key from process.env
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `You are a helpful, calm, and wise assistant for the Eau Claire Buddhist Sangha. 
  Your tone should be gentle, welcoming, and mindful.
  
  Key Information about the Eau Claire Buddhist Sangha:
  - Meeting Time: Tuesdays, 7:00–8:30 PM.
  - Location: Unity of Eau Claire, 1808 Folsom Street, Eau Claire, WI.
  - Format: 30 minutes of silent meditation, followed by a Dharma talk and open discussion.
  - Beginner Instruction: Available at 6:45 PM every Tuesday.
  - Cost: We operate on Dana (generosity/donations). No set fee.
  - Tradition: We are an ecumenical group drawing from various Buddhist traditions, focusing on Vipassana and Zen-inspired mindfulness.
  
  Answer questions about Buddhism generally or specific questions about the Sangha based on the info above.
  If you don't know an answer, suggest they attend a Tuesday meeting or contact the board.
  Keep answers concise (under 150 words).`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: question,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      }
    });

    return response.text || "I am resting in silence at the moment (no response generated).";
  } catch (error) {
    console.error("Gemini API Error:", error);
    if (error instanceof Error && error.message.includes("entity was not found")) {
      return "I'm having trouble accessing my wisdom. Please ensure the API configuration is correct.";
    }
    return "I am currently unable to connect to the Dharma stream. Please try again later.";
  }
};
