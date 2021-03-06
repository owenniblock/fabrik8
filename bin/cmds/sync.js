const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const yaml = require('js-yaml')
const createInfoClient = require('@npm-wharf/cluster-info-client')
const bistre = require('bistre')()
const bole = require('bole')
const log = bole('fabrik8')
const setupKubectx = require('../../lib/kubectx')

exports.command = 'sync'
exports.desc = 'sync vault cluster info to your local kubectl config'

exports.handler = function (argv) {
  main(argv)
    .catch(err => {
      console.error(err.stack)
      process.exit(1)
    })
}

function readKubeConfig () {
  try {
    const configPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config')
    const contents = fs.readFileSync(path.resolve(configPath), { encoding: 'utf8' })
    const config = yaml.safeLoad(contents)
    return config
  } catch (err) {
    return { contexts: [] }
  }
}

async function main (argv) {
  bistre.pipe(process.stdout)
  bole.output({
    level: argv.verbose ? 'debug' : 'info',
    stream: bistre
  })

  // fetch info from vault
  const {
    vaultHost,
    vaultToken,
    vaultRoleId,
    vaultSecretId
  } = argv

  const hasVaultAuth = vaultToken || (vaultRoleId && vaultSecretId)
  if (!vaultHost || !hasVaultAuth) {
    throw new Error('Invalid configuration for cluster-info Vault.')
  }

  const clusterInfo = createInfoClient({ vaultToken, vaultHost, vaultRoleId, vaultSecretId })
  const config = readKubeConfig()
  const currentContext = config['current-context'] || null
  const existingContexts = config.contexts.map(context => context.name).filter(name => name.startsWith('cluster/'))
  const desiredContexts = []

  const syncList = []
  const desiredChannels = ['dev', 'staging', 'production']
  for (const channel of desiredChannels) {
    const clusters = await clusterInfo.listClustersByChannel(channel)
    for (const name of clusters) {
      const desiredName = `cluster/${channel}/${name}`
      desiredContexts.push(desiredName)
      log.info(`checking for ${desiredName}...`)
      if (existingContexts.includes(desiredName)) {
        log.debug('found')
        continue
      }

      log.info(`${name} missing locally. Fetching cluster information from vault...`)
      try {
        const cluster = await clusterInfo.getCluster(name)
        syncList.push([cluster.value.cluster, channel, name])
        log.debug(`${name}: done`)
      } catch (err) {
        log.debug(`${name}: error!`)
        log.error(err.stack)
        process.exitCode = 1
        continue
      }
    }
    await setupKubectx(syncList)
  }

  const extraneousContexts = existingContexts.filter(name => !desiredContexts.includes(name))
  for (const context of extraneousContexts) {
    log.info(`removing unused context ${context}...`)
    try {
      const res = spawnSync('kubectl', ['config', 'delete-context', context])
      if (res.error) {
        throw res.error
      }

      if (res.status !== 0) {
        throw new Error(res.stderr)
      }
      log.debug(`${context} done`)
    } catch (err) {
      log.error(`${context} error!`)
      log.error(err.stack)
      process.exitCode = 1
    }
  }

  if (currentContext) {
    log.info('restoring kubectl context to original value...')
    try {
      const res = spawnSync('kubectl', ['config', 'use-context', currentContext])
      if (res.error) {
        throw res.error
      }

      if (res.status !== 0) {
        throw new Error(res.stderr)
      }
      log.debug(`${currentContext} done`)
    } catch (err) {
      log.debug(`${currentContext} error!`)
      log.error(err.stack)
      process.exitCode = 1
    }
  }
}
