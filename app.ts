import { stripMentionsText } from "@microsoft/teams.api";
import { App  } from "@microsoft/teams.apps";
import { LocalStorage } from "@microsoft/teams.common";
import config from "./config";
import { ManagedIdentityCredential, ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";

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

// --- FUNÇÃO PARA OBTER REUNIÕES VIA GRAPH API (Sem alterações na lógica interna) ---
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
      .get();

    return eventos.value;
  } catch (error) {
    console.error("Erro ao obter as reuniões do usuário:", error);
    throw error;
  }
}

async function obterTranscricoesDoUsuario(graphClient: Client,userId: string , meetingId: string) {
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
    console.log(`Reunião encontrada com sucesso. ID: ${graphMeetingId}`);

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
    console.log(`Transcrição encontrada com sucesso. ID: ${transcriptId}`);

    // --- PASSO 4 (NOVO): Obter o conteúdo da transcrição ---
    // A resposta aqui não é um JSON, mas o conteúdo do arquivo (geralmente em formato VTT)
    const transcriptContent = await graphClient
      .api(`/onlineMeetings/${graphMeetingId}/transcripts/${transcriptId}/content`)
      .get();

    // Retorna o conteúdo da transcrição para ser processado
    return transcriptContent;
  } catch (error) {
    console.error("Erro ao obter as reuniões do usuário:", error);
    throw error;
  }
}
// --- MANIPULADOR DE MENSAGENS DO BOT ---
app.on("message", async (context) => {
  const activity = context.activity;
  const text: string = stripMentionsText(activity);
  
  if (text.toLocaleLowerCase().includes("/reuniões") || text.toLocaleLowerCase().includes("/reunioes")) {
    try {
      const userId = context.activity.from.aadObjectId;

      if (userId) {
        await context.send("Verificando sua agenda... 🗓️");
        const reunioes = await obterReunioesDoUsuario(graphClient, userId);

        if (reunioes && reunioes.length > 0) {
          let resposta = "Aqui estão suas próximas reuniões:\n\n";
          reunioes.forEach((reuniao: any) => {
            resposta += `- **${reuniao.subject}**\n`;
            resposta += `  - Início: ${new Date(reuniao.start.dateTime).toLocaleString()}\n`;
            resposta += `  - Fim: ${new Date(reuniao.end.dateTime).toLocaleString()}\n\n`;
          });
          await context.send(resposta);
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

  if (text.toLocaleLowerCase().includes("/resumir reunião") || text.toLocaleLowerCase().includes("/resumir reuniao")) {
    try{
        let a = context;
        const userId = context.activity.from.aadObjectId;
        const meetingId = context.activity.conversation.id;
        const reunioes = await obterTranscricoesDoUsuario(graphClient, userId ,meetingId);
        await context.send(`O resultado é` + reunioes);

    }catch(error){
      console.error("Erro ao processar o comando de obter resultados:", error);
      await context.send("Ocorreu um erro ao obter os resultados. Verifique o console para mais detalhes.");
    }
    return;
  }

  if (text === "/reset") {
    storage.delete(activity.conversation.id);
    await context.send("Ok I've deleted the current conversation state.");
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

export default app;