# Visão Geral

O Planejador de Reuniões, carinhosamente chamado de Explicadinho é um bot desenvolvido para o Microsoft Teams que auxilia equipes a organizar, conduzir e resumir reuniões de forma automatizada e inteligente.

Ele realiza todo o fluxo de uma reunião de forma integrada:

Planejamento da reunião – solicita o objetivo, os participantes e a pauta principal.

Acompanhamento – utiliza recursos do Teams Premium para capturar a transcrição automática da reunião.

Análise com IA – após o término, o bot gera um resumo com os principais pontos discutidos, decisões e tarefas atribuídas.

Importante: O uso deste bot requer Microsoft Teams Premium, pois depende dos recursos avançados de transcrição e inteligência artificial disponíveis apenas nessa versão.

Esta aplicação foi construída com base na Teams AI Library V2, aproveitando o poder da nuvem para oferecer interações seguras e contextuais com os usuários.

## Como usar

> **Requisitos**
>
> Para executar o projeto do Planejador de Reuniões localmente, é necessário ter instalado:
>
> - [Node.js](https://nodejs.org/), supported versions: 20, 22
> - [Microsoft 365 Agents Toolkit Visual Studio Code Extension](https://aka.ms/teams-toolkit) versão 5.0.0 ou superior ou [Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-toolkit-cli)

> Para depuração local com a CLI, siga as instruções em [Set up your Microsoft 365 Agents Toolkit CLI for local debugging](https://aka.ms/teamsfx-cli-debugging).

Execução Local:

1. No VS Code, selecione o ícone Microsoft 365 Agents Toolkit na barra lateral.
2. Pressione F5 para iniciar a depuração.
3. O aplicativo será aberto automaticamente no Microsoft 365 Agents Playground, mas você pode selecionar diretamente o Teams (web ou desktop)
4. O bot enviará uma mensagem de boas-vindas. Envie qualquer mensagem para iniciar uma interação.

**Parabéns**! Após esses passos, o bot estará em execução e poderá interagir com usuários dentro do Microsoft 365 Agents Playground.

**Funcionalidades do Explicadinho:**

Agendamento inteligente: coleta o objetivo, participantes e pauta da reunião.

Integração com Teams Premium: utiliza transcrição automática e recursos de IA do Teams.

Resumo com IA: gera automaticamente um resumo com os principais pontos, decisões e responsáveis.

Envio pós-reunião: pode enviar o resumo por chat do Teams ou e-mail corporativo.

Segurança e conformidade: utiliza autenticação Microsoft e segue as políticas de segurança do Microsoft 365.

**Implantação**

Para implantar o bot em ambiente corporativo:

1. Provisionar recursos no Azure (App Service e Bot Service).
2. Configurar as variáveis de ambiente no arquivo .env.
3. Realizar o deploy com o Microsoft 365 Agents Toolkit ou via pipeline CI/CD (Azure DevOps).
4. Importar o pacote .zip gerado para o Admin Center do Microsoft Teams.

**Observações Importantes**

1. O bot requer Teams Premium para utilizar transcrição e recursos de IA.
2. Certifique-se de que a transcrição da reunião esteja ativada para todos os participantes.
3. O resumo com IA depende da API de transcrição do Microsoft Graph.

Todos os dados são processados conforme as políticas de segurança e privacidade da Microsoft.

**Licença**

Este projeto está licenciado sob a Licença MIT.
O código pode ser modificado, redistribuído e adaptado conforme as políticas da sua organização.
-----------------------------------------------------------------------------------------------
Desenvolvido pela Equipe 11 - Integrativa Sistemas de Informação UNIPLAC 2025/2
-----------------------------------------------------------------------------------------------