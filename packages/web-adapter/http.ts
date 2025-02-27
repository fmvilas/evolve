import got, { Method } from 'got'
import http from 'http'
import { GleeQuoreAdapter, GleeQuoreMessage } from '@asyncapi/gleequore'
import { ChannelInterface, OperationInterface } from '@asyncapi/parser'
import type { Authenticatable } from './index.d.js'
import GleeQuoreAuth from './wsHttpAuth.js'

class HttpClientAdapter extends GleeQuoreAdapter {
  name(): string {
    return 'HTTP client'
  }
  async connect(): Promise<this> {
      this.emit('connect', {
        name: this.name(),
        adapter: this,
        connection: http,
        channel: this.channelNames,
      })
      return this
  }

  async send(message: GleeQuoreMessage): Promise<void> {
    try {
      this._validateMessage(message)
      await this._sendMessage(message)
    } catch (err) {
      console.warn(`Failed to Send Message: An attempt to send a message to '${this.name()}' on the '${message.channel}' channel was unsuccessful. Please review the error details below for further information and corrective action.`)
      this.emit('error', err)
    }
  }

  async _sendMessageToChannel(message: GleeQuoreMessage, channel: ChannelInterface, operation: OperationInterface) {
    const serverHost = this.serverUrlExpanded
    const httpURL = new URL(serverHost + channel.address())
    const { url, headers, query } = await this._applyAuthConfiguration({ headers: message.headers, query: message.query, url: httpURL })
    const method = this._getHttpMethod(operation)
    const gotRequest = {
      method,
      url,
      body: message.payload,
      searchParams: query as any,
      headers,
    }

    if (!message.payload) delete gotRequest.body
    if (!query) delete gotRequest.searchParams
    if (!headers) delete gotRequest.headers
    if (message.payload && !this._shouldMethodHaveBody(method)) {
      console.warn(`"${method}" can't have a body. Please make sure you are using the correct HTTP method for ${httpURL}. Ignoring the body...`)
      delete gotRequest.body
    }
    try {
      const response = await got(gotRequest)
      const msg = this._createMessage(message, channel.id(), response.body)
      this.emit('message', msg, http)
    } catch (e) {
      const errorMessage = `Error encountered while sending message. Check the request configuration and network status. Method: ${method}, URL: ${url}, Headers: ${JSON.stringify(headers, null, 2)}, Payload: ${JSON.stringify(message.payload, null, 2)}, Query: ${JSON.stringify(query, null, 2)}`
      throw new Error(errorMessage)
    }
  }

  async _applyAuthConfiguration(authenticatable: Authenticatable): Promise<Authenticatable> {
    const authConfig = await this.app.clientAuthConfig(this.serverName)
    const gleeAuth = new GleeQuoreAuth(
      this.AsyncAPIServer,
      this.parsedAsyncAPI,
      this.serverName,
      authConfig
    )

    if (!authConfig) return authenticatable

    const authenticated = await gleeAuth.processClientAuth(authenticatable)
    return { ...authenticated as Authenticatable }
  }

  _getHttpMethod(operation: OperationInterface): Method {
    const method = operation.bindings().get("http")?.json()?.method
    if (!method) {
      console.warn(`"Warning: HTTP Method Not Specified
        In the operation '${operation.id()}', no HTTP method is specified. The system will default to using the GET method. Ensure that this is the intended behavior or specify the appropriate HTTP method in the http operation bindings."`)
      return 'GET'
    }
    return method
  }

  async _sendMessage(message: GleeQuoreMessage) {
    const operation = message.operation
    const operationChannels = operation.channels()
    operationChannels.forEach(channel => this._sendMessageToChannel(message, channel, operation))
  }
  _createMessage(request: GleeQuoreMessage, channelName: string, payload: any) {
    return new GleeQuoreMessage({
      request,
      payload: JSON.parse(JSON.stringify(payload)),
      channel: channelName,
    })
  }

  _validateMessage(message: GleeQuoreMessage) {

    const querySchema = message.operation.bindings().get("http")?.json()?.query
    if (querySchema) this.validate(message.query, querySchema, true)
    const messages = message.operation.messages().all()
    if (!messages.length) return
    const headersSchema = {
      oneOf: messages.map(message => message?.bindings()?.get("http")?.json()?.headers).filter(header => !!header)
    }
    if (headersSchema.oneOf.length > 0) this.validate(message.headers, headersSchema, true)
  }

  _shouldMethodHaveBody(method: Method) {
    return ["post", "put", "patch"].includes(method.toLocaleLowerCase())
  }
}

export default HttpClientAdapter
