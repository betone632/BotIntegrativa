// src/index.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
// Carregue sua chave de API de uma variável de ambiente por segurança
// ou substitua diretamente (NÃO RECOMENDADO EM PRODUÇÃO)
const API_KEY: string = process.env.GEMINI_API_KEY || 'AIzaSyDA2m0HbmK46_C9QJog9rlOb5g2yr-Kn2g';

const genAI = new GoogleGenerativeAI(API_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

async function sendMessage(message: string) {
  try {
    if(message.includes("mas não há transcrições disponíveis.")){
      return "não foi possível obter a transcrição da reunião.";
    }

    let context = "voce é um expecialita em reunioes de trabalho. Resuma a seguinte transcrição de reuniao destacando os pontos principais e as decisoes tomadas, se não tiver nenhuma decisão tomada, apenas resuma os pontos principais e deixe claro que não foi";
    const result = await model.generateContent(context + " transcription: " + message);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error('\nErro ao se comunicar com a IA:', error);
  }
}


export default sendMessage;