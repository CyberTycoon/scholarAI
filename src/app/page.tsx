'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, X, FileText, Image, File, Paperclip, Plus, ChevronDown } from 'lucide-react'

type ModelType = 'gemini' | 'ollama'

interface ChatMessage {
  sender: 'user' | 'system' | 'ai'
  text: string
  files?: UploadedFile[]
}

interface UploadedFile {
  name: string
  size: number
  type: string
  content: string
  id: string
}

// Helper to render Gemini markdown-like output (bold **text**)
function renderGeminiMarkdown(text: string) {
  // Replace **bold** with <strong>bold</strong>
  const bolded = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  // You can add more formatting rules here if needed
  return bolded
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Helper to get file icon
function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <Image className="w-4 h-4" />
  if (type.includes('pdf') || type.includes('document') || type.includes('text')) return <FileText className="w-4 h-4" />
  return <File className="w-4 h-4" />
}

export default function Home() {
  const [chat, setChat] = useState<ChatMessage[]>([
    { sender: 'system', text: "👋 Welcome! I'm ScholarAI, your research assistant. Ask me anything about your research or upload files for analysis!" }
  ])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [model, setModel] = useState<ModelType>('gemini')
  const [ollamaModel, setOllamaModel] = useState('llama3')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isOllamaGuideOpen, setIsOllamaGuideOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // File reading helper
  const readFileContent = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject

      // Read binary files as Data URL, and text files as plain text
      if (
        file.type.startsWith('image/') ||
        file.type.includes('pdf') ||
        file.type.includes('word')
      ) {
        reader.readAsDataURL(file)
      } else {
        reader.readAsText(file, 'UTF-8')
      }
    })
  }, [])

  // Handle file upload
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const newFiles: UploadedFile[] = []
    const maxSize = 10 * 1024 * 1024 // 10MB limit

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      if (file.size > maxSize) {
        setError(`File ${file.name} is too large. Maximum size is 10MB.`)
        continue
      }

      // Check supported file types
      const supportedTypes = [
        'text/plain', 'text/csv', 'text/markdown', 'text/html', 'text/css', 'text/javascript',
        'application/json', 'application/xml', 'text/xml',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
      ]

      const isSupported = supportedTypes.some(type => file.type.includes(type.split('/')[1])) || file.type.startsWith('text/')

      if (!isSupported) {
        setError(`File type ${file.type} is not supported. Please upload text, document, or image files.`)
        continue
      }

      try {
        const content = await readFileContent(file)
        newFiles.push({
          id: Date.now() + i + '',
          name: file.name,
          size: file.size,
          type: file.type,
          content
        })
      } catch (err) {
        setError(`Failed to read file ${file.name}`)
      }
    }

    setUploadedFiles(prev => [...prev, ...newFiles])
  }, [readFileContent])

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFileUpload(e.dataTransfer.files)
  }, [handleFileUpload])

  // Remove uploaded file
  const removeFile = useCallback((id: string) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== id))
  }, [])

  const handleAsk = async (e?: React.FormEvent | React.KeyboardEvent) => {
    e?.preventDefault()
    const userMessage = message.trim()
    if (!userMessage && uploadedFiles.length === 0) return

    const userChatMessage: ChatMessage = {
      sender: 'user',
      text: userMessage || 'File analysis request',
      files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined
    }

    setChat(prev => [...prev, userChatMessage])
    setMessage('')
    setLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('message', userMessage)

      // Add files to form data
      uploadedFiles.forEach((file, index) => {
        formData.append(`file_${index}`, JSON.stringify({
          name: file.name,
          type: file.type,
          content: file.content
        }))
      })
      formData.append('fileCount', uploadedFiles.length.toString())

      const apiEndpoint = model === 'gemini' ? '/api/gemini' : '/api/ollama'
      if (model === 'ollama') {
        formData.append('model', ollamaModel)
      }
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        body: formData
      })

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Server returned HTML instead of JSON. Status: ${response.status}`)
      }

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`)
      }

      if (data.success && data.response) {
        setChat(prev => [...prev, { sender: 'ai', text: data.response }])
      } else {
        throw new Error('Invalid response format from server')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
      setChat(prev => [...prev, { sender: 'ai', text: 'Sorry, I could not process your request.' }])
    } finally {
      setLoading(false)
      setUploadedFiles([]) // Clear uploaded files after sending
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-black flex flex-col w-full font-sans">
      <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto" style={{ minHeight: '100vh' }}>
        {/* Header */}
        <header className="w-full px-4 py-5 border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <span className="bg-gray-900 text-white rounded-md p-2 flex items-center justify-center w-10 h-10">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.52c.2-.22.32-.48.32-.77V3.5c0-.28-.13-.53-.33-.7A4.33 4.33 0 0 0 8 2c-2.2 0-4 1.8-4 4c0 1.4.73 2.63 1.87 3.33c.1.06.2.13.3.2l3.5 3.5c.1.1.2.1.3 0l3.5-3.5c.1-.1.2-.17.3-.22Z" /><path d="m12 6.52-3.5 3.5c-.1.1-.1.2 0 .3l3.5 3.5c.1.1.17.2.22.3c.06.1.13.2.2.3c.7.47 1.6.75 2.58.75c2.2 0 4-1.8 4-4c0-1.4-.73-2.63-1.87-3.33A.83.83 0 0 1 17.5 8V5.77c0-.28-.13-.53-.33-.7A4.33 4.33 0 0 0 13.5 4c-1.4 0-2.63.73-3.33 1.87c-.06.1-.13.2-.2.3Z" /></svg>
              </span>
              <div className="flex flex-col">
                <span className="leading-tight">ScholarAI</span>
                <span className="text-xs font-medium text-gray-500 tracking-wide">Your Research Assistant</span>
              </div>
            </div>
            <div className="relative">
              <button
                onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                <span>Model: {model === 'gemini' ? 'ScholarAI' : 'Ollama (Local)'}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${isModelSelectorOpen ? 'rotate-180' : ''}`} />
              </button>
              {isModelSelectorOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-30 border">
                  <button
                    onClick={() => { setModel('gemini'); setIsModelSelectorOpen(false); }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    ScholarAI (Cloud)
                  </button>
                  <button
                    onClick={() => { setModel('ollama'); setIsModelSelectorOpen(false); }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Ollama (Local)
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {model === 'ollama' && (
          <div className="px-6 py-4 bg-gray-100 border-b">
            <div className="max-w-2xl mx-auto">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-md">Ollama Local Model Configuration</h3>
                <button onClick={() => setIsOllamaGuideOpen(!isOllamaGuideOpen)} className="text-sm text-blue-600 hover:underline">
                  {isOllamaGuideOpen ? 'Hide' : 'Show'} Setup Guide
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                You've selected to use a local model with Ollama. This ensures your data remains private and on your machine.
              </p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600">Model Name</label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-1.5 mt-1 text-sm"
                    placeholder="e.g., llama3"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => inputRef.current?.focus()}
                  className="px-5 py-1.5 rounded-md bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800"
                >
                  Set Model
                </button>
              </div>
              {isOllamaGuideOpen && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-bold text-md mb-2 text-blue-900">Ollama Setup Guide</h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
                    <li>Download and install Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">ollama.ai</a>.</li>
                    <li>Open your terminal and pull a model. For example, to get Llama 3, run: <code className="bg-blue-100 text-blue-900 px-1 rounded">ollama pull llama3</code></li>
                    <li>Run the model with the command: <code className="bg-blue-100 text-blue-900 px-1 rounded">ollama run llama3</code></li>
                    <li>Make sure the Ollama server is running in the background.</li>
                    <li>Enter the model name you installed in the input field above and click "Set Model".</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chat Area */}
        <main
          className={`flex-1 w-full overflow-y-auto px-4 md:px-6 pb-40 transition-all duration-200 ${isDragging ? 'bg-blue-50/50 border-2 border-dashed border-blue-300' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-50 bg-opacity-90 z-10">
              <div className="text-center">
                <Upload className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <p className="text-lg font-medium text-blue-700">Drop files here to upload</p>
                <p className="text-sm text-blue-600">Supports PDF, TXT, DOC, images and more</p>
              </div>
            </div>
          )}

          <div className="w-full p-4 space-y-6">
            {chat.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.sender === 'ai' && (
                  <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.52c.2-.22.32-.48.32-.77V3.5c0-.28-.13-.53-.33-.7A4.33 4.33 0 0 0 8 2c-2.2 0-4 1.8-4 4c0 1.4.73 2.63 1.87 3.33c.1.06.2.13.3.2l3.5 3.5c.1.1.2.1.3 0l3.5-3.5c.1-.1.2-.17.3-.22Z" /><path d="m12 6.52-3.5 3.5c-.1.1-.1.2 0 .3l3.5 3.5c.1.1.17.2.22.3c.06.1.13.2.2.3c.7.47 1.6.75 2.58.75c2.2 0 4-1.8 4-4c0-1.4-.73-2.63-1.87-3.33A.83.83 0 0 1 17.5 8V5.77c0-.28-.13-.53-.33-.7A4.33 4.33 0 0 0 13.5 4c-1.4 0-2.63.73-3.33 1.87c-.06.1-.13.2-.2.3Z" /></svg>
                  </div>
                )}
                <div className={`max-w-2xl ${msg.sender === 'user' ? 'w-full md:w-1/2' : 'w-full'}`}>
                  {msg.sender === 'ai' || msg.sender === 'system' ? (
                    <div
                      className={`px-5 py-3 rounded-2xl text-sm whitespace-pre-line bg-white border border-gray-200/80 shadow-sm text-gray-800`}
                      dangerouslySetInnerHTML={{ __html: renderGeminiMarkdown(msg.text) }}
                    />
                  ) : (
                    <div className={`px-5 py-3 rounded-2xl text-sm whitespace-pre-line bg-gray-900 text-white shadow-md`}>
                      {msg.text}
                    </div>
                  )}

                  {/* Display uploaded files */}
                  {msg.files && msg.files.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {msg.files.map((file) => (
                        <div key={file.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border">
                          <div className="flex-shrink-0">{getFileIcon(file.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center space-x-2 px-4 py-3 rounded-2xl bg-white border border-gray-200/80 shadow-sm">
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse" style={{ animationDelay: '0s' }}></div>
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* File Upload Area */}
        {uploadedFiles.length > 0 && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-4xl px-4 z-10">
            <div className="bg-white/80 backdrop-blur-sm border border-gray-200/80 rounded-lg p-3 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Attached Files</span>
                </div>
                <button onClick={() => setUploadedFiles([])} className="text-xs text-gray-500 hover:underline">Clear all</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border">
                    <div className="flex-shrink-0">{getFileIcon(file.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                      onClick={() => removeFile(file.id)}
                      className="p-1 hover:bg-gray-200 rounded-full transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chat Input Fixed at Bottom */}
        <div
          className="fixed bottom-0 left-0 w-full bg-white/80 backdrop-blur-sm border-t border-gray-200/80 z-20"
        >
          <div className="max-w-4xl mx-auto flex items-center gap-2 px-4 py-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors flex items-center justify-center"
                title="Attach files"
              >
                <svg
                  className="w-5 h-5 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.txt,.doc,.docx,.csv,.json,.md,.png,.jpg,.jpeg,.gif,.webp"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleAsk(e as any)
                }
              }}
              placeholder="Ask a question or upload files for analysis..."
              className="flex-1 rounded-full border-2 border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white text-black transition-shadow"
              style={{ minWidth: 0 }}
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleAsk}
              className="px-5 py-2 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 border border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={(!message.trim() && uploadedFiles.length === 0) || loading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="fixed bottom-20 left-0 w-full flex justify-center z-20">
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl mt-2 max-w-2xl w-full mx-auto">
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-800 text-sm">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="ml-auto text-red-600 hover:text-red-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
