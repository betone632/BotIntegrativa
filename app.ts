import { ActivityLike, stripMentionsText } from "@microsoft/teams.api";
import { App } from "@microsoft/teams.apps";
import { LocalStorage } from "@microsoft/teams.common";
import config from "./config";
import sendMessage from "./AI/ai-response-generator";
import { ManagedIdentityCredential, ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
const { CardFactory } = require('botbuilder');

// Importe e configure o dotenv no início do seu arquivo
import * as dotenv from "dotenv";
// **** CORREÇÃO APLICADA AQUI ****
// Diga ao dotenv para carregar o arquivo .env.local de dentro da pasta env
dotenv.config({ path: "./env/.env.local" });

// Create storage for conversation history
const storage = new LocalStorage();

// --- INÍCIO DA SEÇÃO DE AUTENTICAÇÃO ---
const createAuthProvider = () => {
  const getAccessToken = async (): Promise<string> => {
    let credential;
    // Esta condição agora vai funcionar, pois as variáveis de ambiente serão carregadas corretamente
    if (process.env.AZURE_CLIENT_ID && process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_SECRET) {
      // Ambiente de desenvolvimento local com segredo do cliente
      credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID,
        process.env.AZURE_CLIENT_ID,
        process.env.AZURE_CLIENT_SECRET
      );
    } else {
      // Ambiente de produção (ex: Azure App Service) com Identidade Gerenciada
      credential = new ManagedIdentityCredential({
        clientId: process.env.CLIENT_ID,
      });
    }

    const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
    if (!tokenResponse) {
      throw new Error("Não foi possível obter o token de acesso.");
    }
    return tokenResponse.token;
  };

  return { getAccessToken };
};

const authProvider = createAuthProvider();
const graphClient = Client.initWithMiddleware({ authProvider });

// Create the app with storage
const app = new App({
  storage,
});

// --- SEÇÃO DE ESTADO DA CONVERSA (Sem alterações) ---
interface ConversationState {
  count: number;
}

const getConversationState = (conversationId: string): ConversationState => {
  let state = storage.get(conversationId);
  if (!state) {
    state = { count: 0 };
    storage.set(conversationId, state);
  }
  return state;
};


async function obterReunioesDoUsuario(graphClient: Client, userId: string) {
  try {
    const dataInicio = new Date().toISOString();
    const dataFim = new Date();
    dataFim.setDate(dataFim.getDate() + 7);
    const dataFimISO = dataFim.toISOString();

    const eventos = await graphClient
      .api(`/users/${userId}/events`)
      .select("subject,organizer,start,end,location")
      .filter(`start/dateTime ge '${dataInicio}' and end/dateTime le '${dataFimISO}'`)
      .orderby("start/dateTime ASC")
      .top(10)
      .get();

    return eventos.value;
  } catch (error) {
    console.error("Erro ao obter as reuniões do usuário:", error);
    throw error;
  }
}

async function atualizarReuniao(graphClient: Client, userId: string, meetingId: string, content: string) {
  try {

    const updatedData = {
      body: {
        contentType: "TEXT",
        content: content
      }
    };

    const eventos = await graphClient
      .api(`/users/${userId}/events/${meetingId}`)
      .patch(updatedData);

    return eventos.value;
  } catch (error) {
    console.error("Erro ao obter as reuniões do usuário:", error);
    throw error;
  }
}

async function obterReuniao(graphClient: Client, userId: string, meetingId: string) {
  try {
    const data = new Date();
    data.setDate(data.getDate() - 7);
    const dataInicio = data.toISOString();
    const dataFim = new Date();
    dataFim.setDate(dataFim.getDate() + 7);
    const dataFimISO = dataFim.toISOString();


    const chats = await graphClient
      .api(`/chats/${meetingId}`)
      .select('onlineMeetingInfo')
      .get();

    const encodedJoinWebUrl = encodeURIComponent(chats.onlineMeetingInfo.joinWebUrl);

    const meeting = await graphClient
      .api(`/users/${userId}/onlineMeetings?$filter=JoinWebUrl eq '${encodedJoinWebUrl}'`)
      .get();

    if (!meeting.value || meeting.value.length === 0) {
      throw new Error("Reunião não encontrada.");
    }

    const eventos = await graphClient
      .api(`/users/${userId}/events`)
      .filter(`start/dateTime ge '${dataInicio}' and end/dateTime le '${dataFimISO}'`)
      .get();

    const evento = eventos.value.find((evento: any) => evento.onlineMeeting?.joinUrl === meeting.value[0].joinUrl);
    if (!evento) {
      throw new Error("Evento não encontrado.");
    }

    return evento;
  } catch (error) {
    console.error("Erro ao obter as reuniões do usuário:", error);
    throw error;
  }
}

async function obterTranscricoesDoUsuario(graphClient: Client, userId: string, meetingId: string) {
  try {

    const chats = await graphClient
      .api(`/chats/${meetingId}`)
      .select('onlineMeetingInfo')
      .get();

    const encodedJoinWebUrl = encodeURIComponent(chats.onlineMeetingInfo.joinWebUrl);

    const meeting = await graphClient
      .api(`/users/${userId}/onlineMeetings?$filter=JoinWebUrl eq '${encodedJoinWebUrl}'`)
      .get();

    const onlineMeeting = meeting.value[0];
    const graphMeetingId = onlineMeeting.id;

    // --- PASSO 3 (NOVO): Buscar a transcrição da reunião ---
    const transcriptsResponse = await graphClient
      .api(`/users/${userId}/onlineMeetings/${graphMeetingId}/transcripts`)
      .get();

    // Verifique se existe alguma transcrição associada à reunião
    if (!transcriptsResponse.value || transcriptsResponse.value.length === 0) {
      return `Reunião encontrada (ID: ${graphMeetingId}), mas não há transcrições disponíveis.`;
    }

    // Pega o ID da primeira transcrição encontrada
    const transcriptId = transcriptsResponse.value[0].id;

    const transcriptContent = await graphClient
      .api(`/users/${userId}/onlineMeetings/${graphMeetingId}/transcripts/${transcriptId}/content?$format=text/vtt`)
      .get();

    // Retorna o conteúdo da transcrição para ser processado
    // 2. Verifique se a resposta é de fato um stream
    if (transcriptContent.getReader) {
      // 3. Use a função auxiliar para converter o stream em texto
      const transcript = await streamToString(transcriptContent);

      // 4. Agora você tem o conteúdo completo da transcrição em uma string!
      return transcript;
    }
    else {
      return `Não foi possível obter a transcrição como stream.`;
    }
  } catch (error) {
    console.error("Erro ao obter as reuniões do usuário:", error);
    throw error;
  }
}
// --- MANIPULADOR DE MENSAGENS DO BOT ---
app.on("message", async (context) => {
  const activity = context.activity;
  const text: string = stripMentionsText(activity);
  const userId = context.activity.from.aadObjectId;

  if (context.activity.value && context.activity.value.selectedMeeting) {
    const selectedMeetingId = context.activity.value.selectedMeeting;

    // Cria um Cartão Adaptável que funciona como um formulário
    const formCard = CardFactory.adaptiveCard({
      "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      "version": "1.3",
      "type": "AdaptiveCard",
      "body": [
        {
          "type": "Input.Text",
          "label": "Qual o objetivo da reunião?",
          "id": "assuntoPrincipal",
          "placeholder": "Essa reunião tem como objetivo...",
          "isMultiline": true
        },
        {
          "type": "Input.Text",
          "id": "participantes",
          "label": "Quais participantes devem definir algo?",
          "placeholder": "Fulano deve decidir sobre...",
          "isMultiline": true
        },
        {
          "type": "Input.Text",
          "id": "definicao",
          "label": "Qual a definição que essa reunião deve ter?",
          "placeholder": "Digite a pauta ou descrição aqui...",
          "isMultiline": true
        }
      ],
      "actions": [
        {
          "type": "Action.Submit",
          "title": "Atualizar Reunião",
          // Passamos dados ocultos para saber qual reunião atualizar
          "data": {
            "action": "updateMeetingDetails",
            "meetingId": selectedMeetingId
          }
        }
      ]
    });

    // Envia o formulário para o usuário
    let card: ActivityLike = { type: "message", attachments: [formCard] };
    await context.send(card);
    return;
  }

  if (context.activity.value && context.activity.value.action === 'updateMeetingDetails') {
    const meetingId = context.activity.value.meetingId;
    const novoAssunto = context.activity.value.assuntoPrincipal;
    const novosParticipantesStr = context.activity.value.participantes;
    const novaDefinicao = context.activity.value.definicao;

    const assuntoReuniao = `Assunto: ${novoAssunto}\r\nParticipantes: ${novosParticipantesStr}\r\nDefinição: ${novaDefinicao}`;

    try {
      if (novaDefinicao != undefined) {
        await context.send("Atualizando sua reunião, um momento... ⚙️");

        await atualizarReuniao(graphClient, userId, meetingId, assuntoReuniao);

        await context.send(`A reunião foi atualizada com sucesso! ✅`);
      } else {
        await context.send("Nenhuma alteração foi fornecida.");
      }
    } catch (error) {
      console.error("Erro ao atualizar a reunião:", error);
      await context.send("Ocorreu um erro ao tentar atualizar a reunião. Verifique o console para mais detalhes.");
    }

    return;
  }

  if (text.toLocaleLowerCase().includes("/planejar") || text.toLocaleLowerCase().includes("/planejar reunião") || text.toLocaleLowerCase().includes("/planejar reuniao")) {
    try {


      if (userId) {
        await context.send("Verificando sua agenda... 🗓️");
        const reunioes = await obterReunioesDoUsuario(graphClient, userId);

        if (reunioes && reunioes.length > 0) {
          // Mapeia as reuniões para o formato do ChoiceSet
          const choices = reunioes.map((reuniao: any) => {
            return {
              title: `${reuniao.subject} (${new Date(reuniao.start.dateTime).toLocaleString()})`,
              value: reuniao.id,
            };
          });

          // Cria o Cartão Adaptável
          const adaptiveCard = CardFactory.adaptiveCard({
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            version: "1.3",
            type: "AdaptiveCard",
            body: [
              {
                type: "TextBlock",
                text: "Selecione uma de suas próximas reuniões:",
                weight: "bolder",
                size: "medium",
              },
              {
                type: "Input.ChoiceSet",
                id: "selectedMeeting",
                choices: choices,
                placeholder: "Escolha uma reunião",
              },
            ],
            actions: [
              {
                type: "Action.Submit",
                title: "Planejar",
              },
            ],
          });

          let card: ActivityLike = { type: "message", attachments: [adaptiveCard] };
          await context.send(card);
        } else {
          await context.send("Você não tem nenhuma reunião agendada para os próximos 7 dias.");
        }
      } else {
        await context.send("Não foi possível identificar seu usuário para buscar as reuniões.");
      }
    } catch (error) {
      console.error("Erro ao processar o comando de reuniões:", error);
      if (error.statusCode === 403 || error.code === 'Authorization_RequestDenied') {
        await context.send("Ocorreu um erro. Parece que não tenho permissão para acessar calendários. Verifique se a permissão 'Calendars.Read' (de aplicativo) foi concedida no Azure AD.");
      } else {
        await context.send("Ocorreu um erro ao buscar suas reuniões. Verifique o console para mais detalhes.");
      }
    }
    return;
  }

  if (text.toLocaleLowerCase().includes("/resumir") || text.toLocaleLowerCase().includes("/resumir reunião") || text.toLocaleLowerCase().includes("/resumir reuniao")) {
    try {
      const meetingId = context.activity.conversation.id;
      await context.send(`Trabalhando para obter a transcrição da reunião... 📝`);
      const transcript = await obterTranscricoesDoUsuario(graphClient, userId, meetingId);
      const meeting = await obterReuniao(graphClient, userId, meetingId);
      let iaResponse = await sendMessage(`transcrição: ${transcript} dados da reunião: ${meeting.bodyPreview}`);
      await context.send(iaResponse);

    } catch (error) {
      console.error("Erro ao processar o comando de obter resultados:", error);
      await context.send("Ocorreu um erro ao obter os resultados. Verifique o console para mais detalhes.");
    }
    return;
  }

  if (text.toLocaleLowerCase().includes("/live-helper") || text.toLocaleLowerCase().includes("/live helper")) {
    const meetingId = context.activity.conversation.id;
    const meeting = await obterReuniao(graphClient, userId, meetingId);
    const participantesAtuais = meeting.attendees || [];

    const botJaExiste = participantesAtuais.some(
      (p: any) => p.emailAddress.address === "b5517749-f96f-43df-ace7-7d5334bea7d5"
    );

    if (botJaExiste) {
      console.log("O bot já está na lista de participantes.");
      await context.send("O bot já estava convidado para esta reunião. ✅");
      return;
    }

    // --- PASSO 2: MODIFICAR a lista de participantes ---
    const novoParticipanteBot = {
      emailAddress: {
        address: "b5517749-f96f-43df-ace7-7d5334bea7d5",
        name: "Bot de Resumo de Reuniões"
      },
      type: "required"
    };
    
    const participantesAtualizados = [...participantesAtuais, novoParticipanteBot];

    // --- PASSO 3: ESCREVER (PATCH) a lista atualizada ---
    const updatePayload = {
      attendees: participantesAtualizados
    };
    
    await context.send("Convidando o bot para a reunião... 🤖");
    await graphClient
      .api(`/users/${userId}/events/${meeting.id}`)
      .patch(updatePayload);
      
    await context.send("Bot adicionado com sucesso à reunião!");
    return;
  }

  if (text === "/count") {
    const state = getConversationState(activity.conversation.id);
    await context.send(`The count is ${state.count}`);
    return;
  }

  if (text === "/diag") {
    await context.send(JSON.stringify(activity, null, 2));
    return;
  }

  if (text === "/state") {
    const state = getConversationState(activity.conversation.id);
    await context.send(JSON.stringify(state, null, 2));
    return;
  }

  if (text === "/runtime") {
    const runtime = {
      nodeversion: process.version,
      sdkversion: "2.0.0", // Teams AI v2
    };
    await context.send(JSON.stringify(runtime, null, 2));
    return;
  }

  const state = getConversationState(activity.conversation.id);
  state.count++;
  await context.send(`[${state.count}] you said: ${text}`);
});

async function streamToString(stream) {
  const reader = stream.getReader();
  const textDecoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    result += textDecoder.decode(value);
  }

  return result;
}

async function answerIncomingCall(graphClient: Client, callId: string) {
    
    // O endpoint público do seu Plano de Mídia, exposto via ngrok ou em produção
    const mediaCallbackUri = "https://SEU_ENDPOINT_DE_MIDIA.com/api/media";

    // O corpo da requisição para atender a chamada
    const answerRequestBody = {
        callbackUri: mediaCallbackUri,
        acceptedModalities: ["audio"], // Informa que vamos lidar com áudio
        mediaConfig: {
            "@odata.type": "#microsoft.graph.appHostedMediaConfig",
            "blob": "<Media session configuration blob>"
        }
    };

    try {
        // Envia o comando para a API do Graph
        await graphClient
            .api(`/communications/calls/${callId}/answer`)
            .post(answerRequestBody);

        console.log(`Chamada ${callId} atendida com sucesso!`);
        // Agora, o stream de áudio será enviado para o seu mediaCallbackUri
        
    } catch (error) {
        console.error("Erro ao atender a chamada:", error);
    }
}
export default app;