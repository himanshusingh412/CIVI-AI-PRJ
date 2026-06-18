import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeComplaint(description: string) {
  if (!process.env.GEMINI_API_KEY) return { sentiment: 'Neutral', priority: 'Medium', category: 'General' };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this citizen complaint for a city helpline: "${description}"`,
      config: {
        systemInstruction: "Analyze complaints. Identify sentiment (Frustrated, Neutral, Polite, Angry), priority (Low, Medium, High, Critical), and suggest a category from: [Road & Infrastructure, Water Supply, Electricity, Sanitation, Law & Order, Public Transport, Parks & Recreation, General].",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment: { type: Type.STRING, enum: ["Frustrated", "Neutral", "Polite", "Angry"] },
            priority: { type: Type.STRING, enum: ["Low", "Medium", "High", "Critical"] },
            category: { type: Type.STRING }
          },
          required: ["sentiment", "priority", "category"]
        }
      }
    });

    return JSON.parse(response.text || '{"sentiment": "Neutral", "priority": "Medium", "category": "General"}');
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return { sentiment: 'Neutral', priority: 'Medium', category: 'General' };
  }
}

export async function generateResponseTemplates(complaint: any) {
  if (!process.env.GEMINI_API_KEY) return ["We are looking into it.", "Assigned to the relevant department.", "Will be resolved soon."];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate 3 professional officer responses for this complaint: "${complaint.description}" in category "${complaint.category}".`,
      config: {
        systemInstruction: "Generate 3 distinct, professional response templates for a city official. Keep them concise and action-oriented.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            templates: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["templates"]
        }
      }
    });

    const data = JSON.parse(response.text || '{"templates": []}');
    return data.templates;
  } catch (error) {
    console.error("AI Response Generation failed:", error);
    return ["Thank you for reaching out. We are investigating.", "This issue has been routed to the field team.", "We expect resolution within the SLA period."];
  }
}
