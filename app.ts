import { ActivityLike, stripMentionsText } from "@microsoft/teams.api";
import { App } from "@microsoft/teams.apps";
import { LocalStorage } from "@microsoft/teams.common";
import { CommunicationUserIdentifier, MicrosoftTeamsUserIdentifier, PhoneNumberIdentifier, CommunicationIdentifier } from '@azure/communication-common';
import {
  CallAutomationClient,
  CallInvite,
  StartRecordingOptions,
  parseCallAutomationEvent,
} from '@azure/communication-call-automation';

import config from "./config";
import createAcsIdentity from "./callIdBotgenerator";
import { sendMessage, sendAnalises } from "./AI/ai-response-generator";
import { ManagedIdentityCredential, ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
const { CardFactory } = require('botbuilder');

// Importe e configure o dotenv no início do seu arquivo

if (process.env.NODE_ENV !== 'production' && !process.env.RUNNING_ON_AZURE) {
  console.log("Carregando variáveis de ambiente do arquivo .env.local");
  const dotenv = require("dotenv");
  dotenv.config({ path: "./env/.env.local" });
}

const storage = new LocalStorage();

const createAuthProvider = () => {
  console.log(`${process.env.AZURE_CLIENT_ID}  ${process.env.AZURE_TENANT_ID}  ${process.env.AZURE_CLIENT_SECRET}`);
  const getAccessToken = async (): Promise<string> => {
    let credential;
    if (process.env.AZURE_CLIENT_ID && process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_SECRET) {
      credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID!,
        process.env.AZURE_CLIENT_ID!,
        process.env.AZURE_CLIENT_SECRET!
      );
    } else {
      // É crucial que process.env.CLIENT_ID exista aqui para ManagedIdentityCredential
      if (!process.env.CLIENT_ID) {
        throw new Error("CLIENT_ID não está configurado para Managed Identity.");
      }
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

// --- SEÇÃO DE ESTADO DA CONVERSA ---
interface ConversationState {
  count: number;
  activeCallConnectionId?: string; // Para rastrear a conexão de chamada ativa
  recordingId?: string; // Para rastrear o ID da gravação
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
      .select("subject,organizer,start,end,location,onlineMeeting")
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

async function obterTodasReunioesDoUsuario(graphClient: Client, userId: string) {
  try {
    const eventos = await graphClient
      .api(`/users/${userId}/events`)
      .orderby("start/dateTime ASC")
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

    const transcriptsResponse = await graphClient
      .api(`/users/${userId}/onlineMeetings/${graphMeetingId}/transcripts`)
      .get();

    if (!transcriptsResponse.value || transcriptsResponse.value.length === 0) {
      return `Reunião encontrada (ID: ${graphMeetingId}), mas não há transcrições disponíveis.`;
    }

    const transcriptId = transcriptsResponse.value[0].id;

    const transcriptContent = await graphClient
      .api(`/users/${userId}/onlineMeetings/${graphMeetingId}/transcripts/${transcriptId}/content?$format=text/vtt`)
      .get();

    if (transcriptContent.getReader) {
      const transcript = await streamToString(transcriptContent);
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

async function obterTodasTranscricoesDoUsuario(graphClient: Client, userId: string, reunioes: Object[]) {
  try {

    let trancricoes = []

    for (let i = 0; i < reunioes.length; i++) {
      if(!reunioes[i]["onlineMeeting"])
        continue

      let joinUrl = reunioes[i]["onlineMeeting"]["joinUrl"]
      if(!joinUrl)
        continue;

      const encodedJoinWebUrl = encodeURIComponent(joinUrl);

      const meeting = await graphClient
        .api(`/users/${userId}/onlineMeetings?$filter=JoinWebUrl eq '${encodedJoinWebUrl}'`)
        .get();

      const onlineMeeting = meeting.value[0];
      const graphMeetingId = onlineMeeting.id;

      const transcriptsResponse = await graphClient
        .api(`/users/${userId}/onlineMeetings/${graphMeetingId}/transcripts`)
        .get();

      if (!transcriptsResponse.value || transcriptsResponse.value.length === 0) {
        trancricoes.push(`Reunião encontrada (ID: ${graphMeetingId}), mas não há transcrições disponíveis.`);
        continue;
      }

      const transcriptId = transcriptsResponse.value[0].id;

      const transcriptContent = await graphClient
        .api(`/users/${userId}/onlineMeetings/${graphMeetingId}/transcripts/${transcriptId}/content?$format=text/vtt`)
        .get();

      if (transcriptContent.getReader) {
        const transcript = await streamToString(transcriptContent);
        let finalTranscript = `id:${onlineMeeting} transcript: ${transcript}`
        trancricoes.push(finalTranscript)
      }
      else {
        trancricoes.push(`Não foi possível obter a transcrição como stream.`);
        continue;
      }
    }
    return trancricoes

  } catch (error) {
    console.error("Erro ao obter as reuniões do usuário:", error);
    throw error;
  }
}

const connectionString = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
if (!connectionString) {
  console.error("COMMUNICATION_SERVICES_CONNECTION_STRING não está configurada.");
  process.exit(1);
}

const callAutomationClient = new CallAutomationClient(connectionString);
const callbackUrl = process.env.WEBHOOK_CALLBACK_HOST + "/api/messages";
if (!process.env.WEBHOOK_CALLBACK_HOST) {
  console.error("WEBHOOK_CALLBACK_HOST não está configurado. Isso é necessário para o Call Automation.");
  process.exit(1);
}

app.http.post("api/messages", async (req, res) => {
  try {
    // CORREÇÃO: Chame parseCallAutomationEvent diretamente, não como método do cliente
    const callAutomationEvents = parseCallAutomationEvent(req.body);

    const events = Array.isArray(callAutomationEvents)
      ? callAutomationEvents
      : [callAutomationEvents];

    for (const event of events) {
      // processa normalmente
      switch (event.type) {
        case "CallConnected":
          console.log(`Chamada conectada! ID da Conexão: ${event.callConnectionId}`);
          // Você pode querer armazenar o callConnectionId no estado da conversa se precisar controlá-lo mais tarde
          // Ou iniciar a gravação aqui
          break;
        case "ParticipantsUpdated":
          console.log(`Participantes atualizados na chamada ${event.callConnectionId}`);
          // Para acessar 'participants', o evento CallParticipantsUpdated pode ter uma estrutura ligeiramente diferente
          // Ou o 'participants' pode estar em event.callConnectionProperties.participants.
          // Verifique a estrutura exata do evento ParticipantsUpdated na documentação do SDK.
          // Por enquanto, vamos assumir que event.participants funciona.
          if (event.participants) { // Adicione uma verificação de existência
            for (const participant of event.participants) {
              console.log(` - ${getIdentifierKind(participant.identifier)}: ${getIdentifierValue(participant.identifier)}`);
            }
          }
          break;
        case "RecordingStateChanged":
          console.log(`Estado da gravação mudou para ${event.recordingState} na chamada ${event.callConnectionId}`);
          if (event.recordingState === "active") {
            // Note: recordingId pode vir em uma propriedade diferente, como event.recording.recordingId
            // A documentação do SDK é a melhor fonte aqui. Se event.recordingId não funcionar, ajuste.
            console.log(`Gravação iniciada com ID: ${event.recordingId}`);
            // Armazene o ID da gravação se precisar pará-la ou recuperá-la
            // Você precisaria de um mecanismo para mapear isso de volta para a conversa do Teams.
          } else if (event.recordingState === "inactive") {
            console.log(`Gravação parada para o ID: ${event.recordingId}`);
          }
          break;
        case "CallDisconnected":
          console.log(`Chamada desconectada! ID da Conexão: ${event.callConnectionId}`);
          // Limpe qualquer estado de chamada
          break;
        default:
          console.log(`Evento de Call Automation não tratado: ${event.type}`);
          break;
      }
    }
    res.status(200).send();
  } catch (error) {
    console.error("Erro ao processar evento de callback do Call Automation:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

function getIdentifierKind(identifier: CommunicationIdentifier): string {
  if ('communicationUserId' in identifier && identifier.communicationUserId) return 'communicationUser';
  if ('microsoftTeamsUserId' in identifier && identifier.microsoftTeamsUserId) return 'microsoftTeamsUser';
  if ('phoneNumber' in identifier && identifier.phoneNumber) return 'phoneNumber';
  if ('rawId' in identifier && identifier.rawId) return 'raw';
  return 'unknown';
}

function getIdentifierValue(identifier: CommunicationIdentifier): string {
  if ('communicationUserId' in identifier && identifier.communicationUserId) return identifier.communicationUserId;
  if ('microsoftTeamsUserId' in identifier && identifier.microsoftTeamsUserId) return identifier.microsoftTeamsUserId;
  if ('phoneNumber' in identifier && identifier.phoneNumber) return identifier.phoneNumber;
  if ('rawId' in identifier && identifier.rawId) return identifier.rawId;
  return 'N/A';
}

app.on("message", async (context) => {
  const activity = context.activity;
  const text: string = stripMentionsText(activity);
  const userId = context.activity.from.aadObjectId;
  const conversationId = activity.conversation.id;
  const state = getConversationState(conversationId);

  if (context.activity.value && context.activity.value.selectedMeeting) {
    const selectedMeetingId = context.activity.value.selectedMeeting;
    const reunioes = await obterTodasReunioesDoUsuario(graphClient, userId);
    await context.send("analisando suas reuniões passadas, isso pode demorar um pouco...");
    const transcricoesPassadas = await obterTodasTranscricoesDoUsuario(graphClient, userId, reunioes);
    const analis = await sendAnalises(`actual meetingId: ${selectedMeetingId}`,`usermeetings: ${JSON.stringify(reunioes)}`,`user meetings trancriprions${JSON.stringify(transcricoesPassadas)}`)
    await context.send(analis);
    const formCard = CardFactory.adaptiveCard({
      "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      "version": "1.3",
      "type": "AdaptiveCard",
      "body": [
        {
          "type": "TextBlock",
          "text": "Se puder, adicione mais detalhes da reunião",
          "wrap": true,
          "size": "Medium",
          "weight": "Bolder"
        },
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
          "data": {
            "action": "updateMeetingDetails",
            "meetingId": selectedMeetingId
          }
        }
      ]
    });

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
        // userId! para garantir que não é null ou undefined
        await atualizarReuniao(graphClient, userId!, meetingId, assuntoReuniao);
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

  if (text.toLocaleLowerCase().includes("planejar") 
    || text.toLocaleLowerCase().includes("planejar reunião") 
    || text.toLocaleLowerCase().includes("planejar reuniao")
    || text.toLocaleLowerCase().includes("planeje")) {
    try {
      if (userId) {
        await context.send("Verificando sua agenda... 🗓️");
        const reunioes = await obterReunioesDoUsuario(graphClient, userId);

        if (reunioes && reunioes.length > 0) {
          const choices = reunioes.map((reuniao: any) => {
            return {
              title: `${reuniao.subject} (${new Date(reuniao.start.dateTime).toLocaleString()})`,
              value: reuniao.id,
            };
          });

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
                title: "Analisar",
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
      if (error instanceof Error && ((error as any).statusCode === 403 || (error as any).code === 'Authorization_RequestDenied')) {
        await context.send("Ocorreu um erro. Parece que não tenho permissão para acessar calendários. Verifique se a permissão 'Calendars.Read' (de aplicativo) foi concedida no Azure AD.");
      } else {
        await context.send("Ocorreu um erro ao buscar suas reuniões. Verifique o console para mais detalhes.");
      }
    }
    return;
  }

  if (text.toLocaleLowerCase().includes("resumir") || text.toLocaleLowerCase().includes("resumir reunião") || text.toLocaleLowerCase().includes("resumir reuniao")) {
    try {
      const meetingId = context.activity.conversation.id;
      await context.send(`Trabalhando para obter a transcrição da reunião... 📝`);
      const transcript = await obterTranscricoesDoUsuario(graphClient, userId!, meetingId);
      await context.send(`Trabalhando para obter os dados das reuniões anteriores... 💼`);
      const meeting = await obterReuniao(graphClient, userId!, meetingId);
      const reunioes = await obterTodasReunioesDoUsuario(graphClient, userId);
      await context.send(`Analisando as transcrições ... 🔎`);
      const transcricoesPassadas = await obterTodasTranscricoesDoUsuario(graphClient, userId, reunioes);
      let iaResponse = await sendMessage(`transcrição: ${transcript}`, `dados da reunião: ${meeting.bodyPreview}`, `Reunioes passadas desse usuario: ${JSON.stringify(reunioes)}`,`transcricoes passadas: ${JSON.stringify(transcricoesPassadas)}`);
      await context.send(iaResponse);

    } catch (error) {
      console.error("Erro ao processar o comando de obter resultados:", error);
      await context.send("Ocorreu um erro ao obter os resultados. Voce deve ser o criador da reunião pra ter acesso ao resumo");
    }
    return;
  }

  if (text.toLocaleLowerCase().includes("/joinmeeting") || text.toLocaleLowerCase().includes("/entrarreuniao")) {
    const meetingId = context.activity.conversation.id;
    try {
      if (!userId) {
        await context.send("Não foi possível identificar seu usuário.");
        return;
      }

      await context.send("Buscando link da reunião...");
      const meetingInfo = await obterReuniao(graphClient, userId, meetingId);
      const teamsMeetingLink = meetingInfo.onlineMeeting?.joinUrl;

      if (!teamsMeetingLink) {
        await context.send("Não foi possível encontrar o link da reunião do Teams para esta conversa.");
        return;
      }

      const botAcsIdentity = await createAcsIdentity();
      if (!botAcsIdentity || !botAcsIdentity.acsUserId) {
        await context.send("Não foi possível criar/obter a identidade ACS para o bot.");
        return;
      }

      // ✅ Locator atualizado (JoinMeetingLocator)
      const meetingLocator = {
        meetingLink: teamsMeetingLink
      };

      // ✅ Identificador do bot ACS
      const caller: CommunicationUserIdentifier = {
        communicationUserId: botAcsIdentity.acsUserId
      };

      const callInvite: CallInvite = {
        targetParticipant: caller       // quem está chamando
      };
      await context.send(`Bot entrando na reunião... 🤖`);

      // ✅ Novo fluxo usando createCall()
      const createCallResult = await callAutomationClient.createCall(callInvite, callbackUrl);

      // ✅ Armazenar o ID da conexão ativa
      state.activeCallConnectionId = createCallResult.callConnectionProperties.callConnectionId;
      storage.set(conversationId, state);

      await context.send(
        `Bot solicitou para entrar na reunião. ID da Conexão: \`${state.activeCallConnectionId}\`.\n` +
        `Você receberá notificações quando o bot se conectar e quando a gravação iniciar/parar.`
      );


    } catch (error) {
      console.error("Erro ao fazer o bot entrar na reunião do Teams via Call Automation:", error);
      await context.send("Ocorreu um erro ao tentar fazer o bot entrar na reunião. Verifique o console para mais detalhes.");
    }
    return;
  }

  // **NOVO**: Comando para iniciar a gravação da reunião
  if (text.toLocaleLowerCase().includes("/startrecording") || text.toLocaleLowerCase().includes("/iniciar_gravacao")) {
    if (!state.activeCallConnectionId) {
      await context.send("Nenhuma chamada ativa encontrada para iniciar a gravação. Use `/joinmeeting` primeiro.");
      return;
    }

    try {
      await context.send("Iniciando gravação da reunião... ⏺️");

      const startRecordingResult = await callAutomationClient.getCallRecording().start({
        callConnectionId: state.activeCallConnectionId,
        recordingStateCallbackEndpointUrl: callbackUrl
      });


      if (startRecordingResult && (startRecordingResult as any).recordingId) { // Acessando recordingId como 'any' para flexibilidade
        state.recordingId = (startRecordingResult as any).recordingId;
        storage.set(conversationId, state);
        await context.send(`Gravação iniciada com sucesso! ID da Gravação: \`${(startRecordingResult as any).recordingId}\``);
      } else {
        await context.send("Não foi possível obter um ID de gravação. A gravação pode não ter iniciado ou o resultado não contém 'recordingId'.");
      }

    } catch (error) {
      console.error("Erro ao iniciar gravação:", error);
      await context.send("Ocorreu um erro ao tentar iniciar a gravação. Verifique o console para mais detalhes.");
    }
    return;
  }

  // **NOVO**: Comando para parar a gravação da reunião
  if (text.toLocaleLowerCase().includes("/stoprecording") || text.toLocaleLowerCase().includes("/parar_gravacao")) {
    if (!state.recordingId) {
      await context.send("Nenhuma gravação ativa encontrada para parar.");
      return;
    }

    try {
      await context.send("Parando gravação da reunião... ⏹️");
      await callAutomationClient.getCallRecording().stop(state.recordingId);
      state.recordingId = undefined; // Limpa o ID da gravação
      storage.set(conversationId, state);
      await context.send("Gravação parada com sucesso!");
    } catch (error) {
      console.error("Erro ao parar gravação:", error);
      await context.send("Ocorreu um erro ao tentar parar a gravação. Verifique o console para mais detalhes.");
    }
    return;
  }

  // **NOVO**: Comando para desligar o bot da reunião
  if (text.toLocaleLowerCase().includes("/hangup") || text.toLocaleLowerCase().includes("/desligar")) {
    if (!state.activeCallConnectionId) {
      await context.send("O bot não está em uma chamada ativa nesta conversa.");
      return;
    }

    try {
      await context.send("Desligando o bot da reunião... 👋");
      const callConnection = callAutomationClient.getCallConnection(state.activeCallConnectionId);
      await callConnection.hangUp(true);
      state.activeCallConnectionId = undefined; // Limpa o ID da conexão
      state.recordingId = undefined; // Limpa o ID da gravação se houver
      storage.set(conversationId, state);
      await context.send("Bot desligado da reunião com sucesso!");
    } catch (error) {
      console.error("Erro ao desligar o bot:", error);
      await context.send("Ocorreu um erro ao tentar desligar o bot. Verifique o console para mais detalhes.");
    }
    return;
  }

  if (text.toLocaleLowerCase().includes("/live-helper") || text.toLocaleLowerCase().includes("/live helper")) {
    const meetingId = context.activity.conversation.id;
    // userId! para garantir que não é null ou undefined
    const meeting = await obterReuniao(graphClient, userId!, meetingId);
    const participantesAtuais = meeting.attendees || [];

    const botAadObjectId = "b5517749-f96f-43df-ace7-7d5334bea7d5"; // Substitua pelo AAD Object ID real do seu bot
    const botEmail = "b5517749-f96f-43df-ace7-7d5334bea7d5@yourtenant.onmicrosoft.com"; // Substitua pelo email real do seu bot

    const botJaExiste = participantesAtuais.some(
      (p: any) => (p.emailAddress && p.emailAddress.address === botEmail) ||
        (p.microsoftTeamsUser && p.microsoftTeamsUser.microsoftTeamsUserId === botAadObjectId)
    );

    if (botJaExiste) {
      console.log("O bot já está na lista de participantes do evento.");
      await context.send("O bot já estava convidado para esta reunião via Graph API. ✅");
      return;
    }

    const novoParticipanteBot = {
      emailAddress: {
        address: botEmail,
        name: "Bot de Resumo de Reuniões"
      },
      type: "required"
    };

    const participantesAtualizados = [...participantesAtuais, novoParticipanteBot];

    await context.send("Convidando o bot para a reunião via Graph API... 🤖");
    await graphClient
      .api(`/users/${userId!}/events/${meeting.id}`) // userId!
      .patch({ attendees: participantesAtualizados });

    await context.send("Bot adicionado com sucesso à reunião (via Graph API)! Use `/joinmeeting` para que o bot se conecte via Call Automation.");
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
      sdkversion: "2.0.0",
    };
    await context.send(JSON.stringify(runtime, null, 2));
    return;
  }

  state.count++;
  await context.send(`não tenho nenhum comando: ${text}`);
});

async function streamToString(stream: ReadableStream<Uint8Array>) {
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

export default app;