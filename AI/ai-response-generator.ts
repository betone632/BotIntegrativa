// src/index.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
// Carregue sua chave de API de uma variável de ambiente por segurança
// ou substitua diretamente (NÃO RECOMENDADO EM PRODUÇÃO)
const API_KEY: string = process.env.GEMINI_API_KEY || 'AIzaSyBRKHijQrr86Lph21vELVHPCfZq8sqceNU';

const genAI = new GoogleGenerativeAI(API_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

async function sendMessage(trancript: string, meetData: string, userMeetings: string, transcricoesPassadas: string) {
  try {
    if(trancript.includes("mas não há transcrições disponíveis.")){
      return "não foi possível obter a transcrição da reunião.";
    }

    let comand = "voce é um expecialista em reunioes de trabalho. na resposta oculte detalhes sobre isso, "+
    "oculte id de reuniao, ou outros dados senseiveis na sua resposta. Resuma a seguinte "+
    "transcrição de reuniao destacando os pontos principais e as decisoes tomadas, se não tiver nenhuma decisão tomada em formato do"+
    "exemplo a seguir Organizador da reunião – Ficou responsável por agendar a próxima reunião e enviar o link de acesso pelo Microsoft Teams"+
    "Facilitador – Ficou determinado que ele deve elaborar a pauta e conduzir as próximas discussões"+
    "Secretário – Ficou responsável por registrar as decisões tomadas e compartilhar a ata com todos os participantes."+
    "Participante 1 – Ficou determinado que deve apresentar o relatório de resultados na próxima reunião."+
    "Participante 2 – Ficou responsável por reunir dados atualizados do setor e enviá-los até sexta-feira."+
    "Administrador de TI – Ficou determinado que deve verificar a estabilidade da conexão e testar o som e vídeo antes do início da próxima reunião."+
    "Líder – Ficou responsável por acompanhar o andamento das tarefas e garantir o cumprimento dos prazos definidos."+
    "apenas resuma os pontos principais e deixe claro que não foi"+
    "foco nos pontos Assunto,Participantes e Definição, destaque oque foi falado na reuniao e vincule com esses pontos."+
    "IMPORTENTE: traga o score da reunião baseado em quanto produtiva ela foi de 1 a 10"+
    "IMPORTENTE: traga se a reunião já não teve outra com o mesmo assunto";
    const result = await model.generateContent(`${comand}  contex:  ${trancript} \r\n ${meetData} \r\n ${userMeetings} \r\n ${userMeetings} \r\n ${transcricoesPassadas}`);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error('\nErro ao se comunicar com a IA:', error);
  }
}

async function sendAnalises(selectedMeeting: string, reunioes: string, transcricoesPassadas: string) {
  try {
    
    if(selectedMeeting == undefined){
      return "não foi possível obter a transcrição da reunião.";
    }

    let comand = "voce é um auxiliar de gestor útil. na resposta oculte detalhes sobre isso, "+
    "oculte id de reuniao, ou outros dados sensiveis na sua resposta. Resuma a seguinte "+
    "voce deve analisar a reuniao atual do usuario, as outras reunioes e suas transcricoes, trazer todas as informacoes possiveis que"+
    "batam com a reuniao atual, se nao tiver apenas diga que nao tem, como definicoes em reunioes antigas, quantas vezes essa reuniao foi feito"+
    "se alguma reuniao parecida já aconteceu"+
    "NAO TRAGA INFORMACOES sobre outras transcrições que nao sejam revelevantes para a reunião atual"+
    "NAO TRAGA INFORMACOES se forem irrelevantes como quem é o organizador, contéudo, traga apenas se tiverem peso sobre assunto"
    const result = await model.generateContent(`${comand}  contex:  ${selectedMeeting} \r\n ${reunioes}  \r\n ${transcricoesPassadas}`);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error('\nErro ao se comunicar com a IA:', error);
    
    return "Desculpe, houve um erro ao processar as requisicões, tente novamente...";
  }
}


export {sendMessage, sendAnalises};