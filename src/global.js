const firstVisited = localStorage.getItem('firstVisited')

console.log('LocalStorage data:', { firstVisited })

let state = {
  recording: false,
  mediaRecorder: null,
  audioChunks: [],
  ready: false,
  greetingText: '',
  greetingAudio: null
}

const log = (action, startTime, result) => {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  const tokens = result?.usage ? ` ${result.usage.total_tokens}t` : ''
  console.log(`/${action} ${duration}s${tokens}`)
}

const updateStatus = text => {
  console.log(`Status: ${text}`)
  document.body.innerHTML = `<div>${text}</div>`
}

const showButton = (text, onClick) => {
  const btn = document.createElement('button')
  btn.textContent = text
  btn.onclick = () => {
    console.log(`Button clicked: ${text}`)
    onClick()
  }
  document.body.innerHTML = ''
  document.body.appendChild(btn)
}

const generateAudio = async (text, purpose = 'audio') => {
  const start = Date.now()
  try {
    const response = await fetch('https://us-central1-samantha-374622.cloudfunctions.net/openai-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'tts-1', voice: 'echo' })
    })
    const audioBlob = await response.blob()
    log(`openai-tts ${purpose}`, start)
    return new Audio(URL.createObjectURL(audioBlob))
  } catch (error) {
    console.log('TTS error:', error)
    throw error
  }
}

const playAudio = async audio => {
  if (!audio) return
  return new Promise(resolve => {
    audio.onended = resolve
    audio.play()
  })
}

const generateText = async (prompt, purpose = 'text') => {
  const start = Date.now()
  try {
    const response = await fetch('https://us-central1-samantha-374622.cloudfunctions.net/openai-4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are Pastor Bot, a warm, charismatic evangelical pastor with a British accent. Keep responses conversational and authentic.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200
      })
    })
    const result = await response.json()
    log(`openai-4 ${purpose}`, start, result)
    return result.choices[0].message.content
  } catch (error) {
    console.log('Chat error:', error)
    throw error
  }
}

const transcribe = async audioBlob => {
  const start = Date.now()
  const reader = new FileReader()
  const base64 = await new Promise(resolve => {
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.readAsDataURL(audioBlob)
  })

  try {
    const response = await fetch('https://us-central1-samantha-374622.cloudfunctions.net/openai-stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, model: 'whisper-1' })
    })
    const result = await response.json()
    log('openai-stt transcription', start)
    return result.text
  } catch (error) {
    console.log('STT error:', error)
    throw error
  }
}

const startSession = async () => {
  try {
    if (!firstVisited) localStorage.setItem('firstVisited', Date.now())

    if (!state.greetingAudio) {
      updateStatus('One moment')
      while (!state.greetingAudio) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    updateStatus('Pastor Bot is talking')
    await playAudio(state.greetingAudio)

  // Generate transition text and audio in background while user is sharing
  const transitionPromise = generateText('Generate a simple, gentle transition under 30 words like "Thank you for sharing. Let me pray for you now. You can bow your head and close your eyes or whatever posture you feel comfortable with that might help you feel open, receptive, unguarded, and welcoming of the Spirit."', 'transition')
    .then(text => generateAudio(text, 'transition'))

  updateStatus('Pastor Bot is listening')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mediaRecorder = new MediaRecorder(stream)
  const audioChunks = []

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data)
  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })

    // Start transcription immediately
    const transcriptionPromise = transcribe(audioBlob)

    // Start prayer generation as soon as transcription completes
    const prayerPromise = transcriptionPromise.then(transcription =>
      generateText(`Based on what this person shared: "${transcription}", please create a heartfelt, personal prayer under 100 words for them. After "Amen", add a brief encouragement and remind them "I am always here when you need me, 24/7" or similar.`, 'prayer')
    )

    // Start prayer audio generation as soon as prayer text is ready
    const prayerAudioPromise = prayerPromise.then(prayer =>
      prayer ? generateAudio(prayer, 'prayer') : null
    )

    updateStatus('Pastor Bot is talking')
    const transitionAudio = await transitionPromise
    await playAudio(transitionAudio)

    await transcriptionPromise

    // Only show thinking if prayer isn't ready yet
    const prayerAudio = await Promise.race([
      prayerAudioPromise,
      new Promise(resolve => setTimeout(() => resolve(null), 100))
    ])

    if (!prayerAudio) {
      updateStatus('Pastor Bot is thinking')
    }

    const finalPrayerAudio = prayerAudio || await prayerAudioPromise
    if (finalPrayerAudio) {
      updateStatus('Pastor Bot is praying')
      await playAudio(finalPrayerAudio)
    }

    document.body.innerHTML = ''

    const message = document.createElement('div')
    message.textContent = 'Let us know what you think!'
    document.body.appendChild(message)

    const link = document.createElement('a')
    link.href = 'https://discord.gg/ng8RNjm5Jz'
    link.textContent = 'Join our Discord'
    document.body.appendChild(link)
  }

  mediaRecorder.start()

  setTimeout(() => {
    showButton("I'm done sharing", () => {
      mediaRecorder.stop()
      stream.getTracks().forEach(track => track.stop())
    })
  }, 10000)
  } catch (error) {
    console.error('Session error:', error)
    alert('Something went wrong. Please refresh and try again.')
  }
}


// Initialize - show button immediately, generate content in background
showButton('Meet Pastor Bot', startSession)

// Pre-generate greeting in background
const greeting = !firstVisited ? "Hello! I'm Pastor Bot." : "Good to see you again."
generateText(`Generate a warm, unique greeting under 20 words that includes: "${greeting}" Then ask: "I'd love an opportunity to pray for you. Can you tell me a little about yourself and what you have going on in your life?"`, 'greeting')
  .then(text => {
    state.greetingText = text || `${greeting} I'd love an opportunity to pray for you. Can you tell me a little about yourself and what you have going on in your life?`
    return generateAudio(state.greetingText, 'greeting')
  })
  .then(audio => {
    state.greetingAudio = audio
  })