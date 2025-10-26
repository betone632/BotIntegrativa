import { CommunicationIdentityClient } from "@azure/communication-identity";
import { AzureCommunicationTokenCredential } from '@azure/communication-common';
import * as dotenv from "dotenv";

dotenv.config({ path: "./env/.env.local" }); // Certifique-se de carregar suas variáveis de ambiente

async function createAcsIdentity() {
    const connectionString = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;

    if (!connectionString) {
        console.error("COMMUNICATION_SERVICES_CONNECTION_STRING não está configurada.");
        return;
    }

    const identityClient = new CommunicationIdentityClient(connectionString);

    try {
        const identityResponse = await identityClient.createUser();
        const acsUserId = identityResponse.communicationUserId;
        console.log("Nova identidade ACS criada:", acsUserId);

        const tokenResponse = await identityClient.getToken(identityResponse, ["voip"]);
        let credential = new AzureCommunicationTokenCredential(tokenResponse.token)
        console.log("Token de acesso:", tokenResponse.token);
        console.log("Expira em:", tokenResponse.expiresOn);

        return { acsUserId, token: tokenResponse.token, expiresOn: tokenResponse.expiresOn, credential: credential };

    } catch (error) {
        console.error("Erro ao criar identidade ACS:", error);
        return { acsUserId: null, token: null, expiresOn: null, credential: null };
    }
}

export default createAcsIdentity;