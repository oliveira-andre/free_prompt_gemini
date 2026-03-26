const chats = Array.from(JSON.parse(localStorage.getItem('chats') || '[]'));

const aiContext = {
  session: null,
  abortController: null,
  isGenerating: false,
};

const elements = {
  temperature: document.getElementById('temperature'),
  temperatureValue: document.getElementById('temp-value'),
  topKValue: document.getElementById('topk-value'),
  topK: document.getElementById('topK'),
  form: document.getElementById('question-form'),
  questionInput: document.getElementById('question'),
  output: document.getElementById('output'),
  button: document.getElementById('ask-button'),
  year: document.getElementById('year'),
}

async function setupEventListeners() {

  // Update display values for range inputs
  elements.temperature.addEventListener('input', (e) => {
      elements.temperatureValue.textContent = e.target.value;
  });

  elements.topK.addEventListener('input', (e) => {
      elements.topKValue.textContent = e.target.value;
  });

  elements.form.addEventListener('submit', async function (event) {
      event.preventDefault();

      if (aiContext.isGenerating) {
          toggleSendOrStopButton(false)
          return;
      }

      onSubmitQuestion();
  });
}

async function onSubmitQuestion() {
  const questionInput = elements.questionInput;
  const output = elements.output;
  const question = questionInput.value;

  if (!question.trim()) {
      return;
  }

  // Get parameters from form
  const temperature = parseFloat(elements.temperature.value);
  const topK = parseInt(elements.topK.value);
  console.log('Using parameters:', { temperature, topK });

  // Change button to stop mode
  toggleSendOrStopButton(true)

  output.textContent = 'Processing your question...';
  const aiResponseChunks = await askAI(question, temperature, topK);

  let fullText = ""

  for await (const chunk of aiResponseChunks) {
      if (aiContext.abortController.signal.aborted) {
          break;
      }
      // console.log('Received chunk:', chunk);
      fullText += chunk;
      output.innerHTML = markdown.toHTML(fullText);
  }
  // console.log(fullText);
  // output.innerHTML = markdown.toHTML(fullText);

  chats.filter(chat => chat.id === chats.length)[0].prompts.push(
    {
      role: 'assistant',
      content: fullText,
    }
  );

  localStorage.setItem('chats', JSON.stringify(chats));
  updateChatList();

  toggleSendOrStopButton(false);
}

function toggleSendOrStopButton(isGenerating) {
  if (isGenerating) {
      // Switch to stop mode
      aiContext.isGenerating = isGenerating;
      elements.button.textContent = 'Parar';
      elements.button.classList.add('stop-button');
  } else {
      // Switch to send mode
      aiContext.abortController?.abort();
      aiContext.isGenerating = isGenerating;
      elements.button.textContent = 'Enviar';
      elements.button.classList.remove('stop-button');
  }
}
async function* askAI(question, temperature, topK) {
  aiContext.abortController?.abort();
  aiContext.abortController = new AbortController();

  // Destroy previous session and create new one with updated parameters
  if (aiContext.session) {
      aiContext.session.destroy();
  }

  let chatsPrompts = [];
  if (chats.length === 0) {
    chats.push({
      id: 1,
      prompts: [
        {
          role: 'system',
          content: 'You are an AI assistant that answers in a clear and objective way.'
        }
      ]
    });
    chatsPrompts = chats[0].prompts;
  } else {
    chatsPrompts = chats.filter(chat => chat.id === chats.length)[0].prompts;
  }

  const session = await LanguageModel.create({
      expectedInputLanguages: ["en", "pt"],
      temperature: temperature,
      topK: topK,
      initialPrompts: chatsPrompts,
  });

  const responseStream = await session.promptStreaming(
      [
          {
              role: 'user',
              content: question,
          },
      ],
      {
          signal: aiContext.abortController.signal,
      }
  );

  chats.filter(chat => chat.id === chats.length)[0].prompts.push(
    {
      role: 'user',
      content: question,
    }
  );

  localStorage.setItem('chats', JSON.stringify(chats));
  updateChatList();

  for await (const chunk of responseStream) {
      if (aiContext.abortController.signal.aborted) {
          break;
      }
      yield chunk;
  }
}

async function checkRequirements() {
  const errors = [];
  const returnResults = () => errors.length ? errors : null;

  // @ts-ignore
  const isChrome = !!window.chrome;
  if (!isChrome)
      errors.push("⚠️ Este recurso só funciona no Google Chrome ou Chrome Canary (versão recente).");
  if (!('LanguageModel' in self)) {
      errors.push("⚠️ As APIs nativas de IA não estão ativas.");
      errors.push("Ative a seguinte flag em chrome://flags/:");
      errors.push("- Prompt API for Gemini Nano (chrome://flags/#prompt-api-for-gemini-nano)");
      errors.push("Depois reinicie o Chrome e tente novamente.");
      return returnResults();
  }

  const availability = await LanguageModel.availability({ languages: ["pt"] });
  console.log('Language Model Availability:', availability);
  if (availability === 'available') {
      return returnResults();
  }

  if (availability === 'unavailable') {
      errors.push(`⚠️ O seu dispositivo não suporta modelos de linguagem nativos de IA.`);
  }

  if (availability === 'downloading') {
      errors.push(`⚠️ O modelo de linguagem de IA está sendo baixado. Por favor, aguarde alguns minutos e tente novamente.`);
  }

  if (availability === 'downloadable') {
      errors.push(`⚠️ O modelo de linguagem de IA precisa ser baixado, baixando agora... (acompanhe o progresso no terminal do chrome)`);
      try {
          const session = await LanguageModel.create({
              expectedInputLanguages: ["pt"],
              monitor(m) {
                  m.addEventListener('downloadprogress', (e) => {
                      const percent = ((e.loaded / e.total) * 100).toFixed(0);
                      console.log(`Downloaded ${percent}%`);
                  });
              }
          });
          await session.prompt('Olá');
          session.destroy();

          // Re-check availability after download
          const newAvailability = await LanguageModel.availability({ languages: ["pt"] });
          if (newAvailability === 'available') {
              return null; // Download successful
          }
      } catch (error) {
          console.error('Error downloading model:', error);
          errors.push(`⚠️ Erro ao baixar o modelo: ${error.message}`);
      }
  }

  return returnResults();

}

function selectChat(chatId) {
  const currentChat = chats.filter(chat => chat.id === chatId)[0];
  let allChats = chats.filter(chat => chat.id !== chatId);

  if (allChats.length === 0 || !currentChat) {
    return;
  }

  allChats.forEach(chat => {
    chat.id > currentChat.id ? chat.id-- : chat.id;
  });

  currentChat.id = allChats.length + 1;
  localStorage.setItem('chats', JSON.stringify([...allChats, currentChat]));
  updateChatList();
}

function updateChatList() {
  const chatList = document.getElementById('chatList');

  if (chats.length > 0) {
    chatList.innerHTML = [...chats].reverse().map(chat => {
      const lastMsg = chat.prompts[chat.prompts.length - 1];
      const preview = lastMsg.content.length > 60
        ? lastMsg.content.slice(0, 60) + '...'
        : lastMsg.content;
      return `
        <div class="sidebar-chat-item" data-chat-id="${chat.id}">
          <div class="sidebar-chat-label">
            <span class="dot-indicator"></span>
            Chat #${chat.id}
          </div>
          <div class="sidebar-chat-preview">${preview}</div>
        </div>
      `;
    }).join('');
  } else {
    chatList.innerHTML = '<p class="sidebar-empty-msg">Nenhum chat encontrado</p>';
  }

  document.querySelectorAll('.sidebar-chat-item').forEach(element => {
    element.addEventListener('click', () => selectChat(parseInt(element.dataset.chatId)));
  });

  const currentChat = chats.filter(chat => chat.id === chats.length)[0];
  const chatHistory = document.getElementById('chat-history');
  if (!currentChat) {
    chatHistory.innerHTML = '';
    return;
  }

  const visiblePrompts = currentChat.prompts.filter(p => p.role !== 'system');
  if (visiblePrompts.length === 0) {
    chatHistory.innerHTML = '';
    return;
  }

  const userIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const aiIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12h8M12 8v8"/></svg>`;

  chatHistory.innerHTML = `
    <div class="chat-history-header">
      <span class="label-tag">Histórico</span>
    </div>
    <div class="chat-history-inner">
      ${visiblePrompts.map(prompt => {
        const isUser = prompt.role === 'user';
        return `
          <div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}">
            <div class="chat-bubble-role">
              ${isUser ? userIcon : aiIcon}
              ${isUser ? 'Você' : 'AI'}
            </div>
            <div class="chat-bubble-content">${prompt.content}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

(async function main() {
    const tempInput = document.getElementById('temperature');
    const tempVal = document.getElementById('temp-value');
    const topKInput = document.getElementById('topK');
    const topKVal = document.getElementById('topk-value');
    const chatSidebar = document.getElementById('chats');

    updateChatList();
    function updateRange(input) {
      const min = +input.min || 0, max = +input.max || 2;
      const pct = ((+input.value - min) / (max - min)) * 100;
      input.style.setProperty('--pct', pct + '%');
    }

    tempInput.addEventListener('input', () => {
      tempVal.textContent = tempInput.value;
      updateRange(tempInput);
    });

    topKInput.addEventListener('input', () => {
      topKVal.textContent = topKInput.value;
    });

    // Init
    tempVal.textContent = tempInput.value;
    topKVal.textContent = topKInput.value;
    updateRange(tempInput);

  elements.year.textContent = new Date().getFullYear();


  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function toggleSidebar() {
    const isOpen = chatSidebar.classList.contains('open');
    if (isOpen) {
      chatSidebar.classList.remove('open');
      sidebarOverlay.classList.remove('visible');
      setTimeout(() => sidebarOverlay.classList.add('hidden'), 300);
    } else {
      sidebarOverlay.classList.remove('hidden');
      requestAnimationFrame(() => {
        chatSidebar.classList.add('open');
        sidebarOverlay.classList.add('visible');
      });
    }
  }

  document.querySelectorAll('.toggle-sidebar').forEach(element => {
    element.addEventListener('click', toggleSidebar);
  });

  sidebarOverlay.addEventListener('click', toggleSidebar);

  function newChat() {
    chats.push({
      id: chats.length + 1,
      prompts: [
        {
          role: 'system',
          content: 'You are an AI assistant that answers in a clear and objective way.'
        }
      ]
    });
    localStorage.setItem('chats', JSON.stringify(chats));
    updateChatList();
  }

  document.querySelectorAll('.new-chat-button').forEach(element => {
    element.addEventListener('click', newChat);
  });
  

  const reqErrors = await checkRequirements();
  if (reqErrors) {
      elements.output.innerHTML = reqErrors.join('<br/>');
      elements.button.disabled = true;
      return;
  }

  const params = await LanguageModel.params();
  console.log('Language Model Params:', params);
  /*
  defaultTemperature: 1
  defaultTopK:3
  maxTemperature:2
  maxTopK:128
  */

  elements.topK.max = params.maxTopK;
  elements.topK.min = 1;
  elements.topK.value = params.defaultTopK;
  elements.topKValue.textContent = params.defaultTopK;

  elements.temperatureValue.textContent = params.defaultTemperature;
  elements.temperature.max = params.maxTemperature;
  elements.temperature.min = 0;
  elements.temperature.value = params.defaultTemperature;
  return setupEventListeners()
})();

