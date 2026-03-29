pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 60, unit: 'MINUTES')
        timestamps()
    }

    parameters {
        booleanParam(
            name: 'DEPLOY',
            defaultValue: true,
            description: 'Deploy the active Docker Compose stack after validation.'
        )
        booleanParam(
            name: 'ALLOW_NON_MAIN_DEPLOY',
            defaultValue: false,
            description: 'Allow deployment from a branch other than main/master.'
        )
        string(
            name: 'DISCOVERY_ALIAS_HOSTNAME',
            defaultValue: 'econnect.local',
            description: 'LAN hostname to publish for browser discovery during Docker deployment.'
        )
        string(
            name: 'DISCOVERY_ALIAS_IP',
            defaultValue: '',
            description: 'Optional explicit LAN IP for the alias. Leave blank to auto-detect on the Jenkins node.'
        )
    }

    environment {
        COMPOSE_FILE = 'docker-compose.yml:docker-compose.jenkins.yml'
        COMPOSE_PROJECT_NAME = 'econnect'
        DOCKER_BUILDKIT = '1'
        BUILDKIT_PROGRESS = 'plain'
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source from SCM...'
                checkout scm
            }
        }

        stage('Preflight') {
            steps {
                script {
                    def mergeCsv = { String currentValue, String addition ->
                        def entries = []
                        if (currentValue?.trim()) {
                            entries.addAll(currentValue.split(',').collect { it.trim() }.findAll { it })
                        }
                        if (addition?.trim()) {
                            entries.addAll(addition.split(',').collect { it.trim() }.findAll { it })
                        }
                        entries.unique().join(',')
                    }
                    def isPrivateIpv4 = { String candidate ->
                        def normalized = candidate?.trim()
                        if (!normalized || !(normalized ==~ /^(\d{1,3}\.){3}\d{1,3}$/)) {
                            return false
                        }

                        def octets = normalized.tokenize('.').collect { it as Integer }
                        if (octets.any { it < 0 || it > 255 }) {
                            return false
                        }

                        return octets[0] == 10 ||
                            octets[0] == 127 ||
                            (octets[0] == 192 && octets[1] == 168) ||
                            (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                    }
                    def isCommonDockerBridgeIpv4 = { String candidate ->
                        def normalized = candidate?.trim()
                        if (!isPrivateIpv4(normalized)) {
                            return false
                        }

                        def octets = normalized.tokenize('.').collect { it as Integer }
                        return (octets[0] == 172 && octets[1] >= 17 && octets[1] <= 31) ||
                            (octets[0] == 192 && octets[1] == 168 && octets[2] == 65)
                    }
                    def privateIpv4FromUrl = { String rawUrl ->
                        def normalized = rawUrl?.trim()
                        if (!normalized) {
                            return null
                        }

                        def matcher = normalized =~ /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^\/?#]+)/
                        if (!matcher.find()) {
                            return null
                        }

                        def authority = matcher.group(1)?.trim()
                        if (!authority) {
                            return null
                        }

                        def host = authority.tokenize('@')[-1]
                        if (host.startsWith('[')) {
                            return null
                        }

                        def normalizedHost = host.tokenize(':')[0]?.trim()
                        return isPrivateIpv4(normalizedHost) ? normalizedHost : null
                    }

                    env.RESOLVED_BRANCH = sh(
                        returnStdout: true,
                        script: '''
                            set -eu

                            for candidate in "${CHANGE_BRANCH:-}" "${BRANCH_NAME:-}" "${GIT_LOCAL_BRANCH:-}" "${GIT_BRANCH:-}"; do
                                if [ -n "$candidate" ]; then
                                    printf '%s' "$candidate" | sed -e 's#^origin/##' -e 's#^\\*/##'
                                    exit 0
                                fi
                            done

                            remote_branches="$(git for-each-ref --format='%(refname:short)' refs/remotes/origin --contains HEAD \
                                | sed 's#^origin/##' \
                                | grep -v '^HEAD$' || true)"

                            if [ -n "$remote_branches" ]; then
                                printf '%s\n' "$remote_branches" | awk '/^(main|master)$/{ print; found=1; exit } END { if (!found && NR > 0) print $1 }'
                            else
                                printf 'detached'
                            fi
                        '''
                    ).trim()
                    echo "Resolved branch: ${env.RESOLVED_BRANCH}"

                    if (params.DEPLOY) {
                        env.DISCOVERY_ALIAS_HOSTNAME = params.DISCOVERY_ALIAS_HOSTNAME?.trim()
                            ? params.DISCOVERY_ALIAS_HOSTNAME.trim()
                            : 'econnect.local'
                        def explicitDiscoveryAliasIp = params.DISCOVERY_ALIAS_IP?.trim()
                        def aliasIpProvidedByUser = explicitDiscoveryAliasIp ? true : false
                        env.DISCOVERY_ALIAS_IP = explicitDiscoveryAliasIp
                        def ciDiscoveryAliasIp = null

                        if (!env.DISCOVERY_ALIAS_IP) {
                            for (candidateUrl in [env.JENKINS_URL, env.BUILD_URL]) {
                                ciDiscoveryAliasIp = privateIpv4FromUrl(candidateUrl)
                                if (ciDiscoveryAliasIp) {
                                    env.DISCOVERY_ALIAS_IP = ciDiscoveryAliasIp
                                    echo "Using Jenkins URL host ${ciDiscoveryAliasIp} as the discovery alias IP."
                                    break
                                }
                            }
                        }

                        if (!env.DISCOVERY_ALIAS_IP) {
                            env.DISCOVERY_ALIAS_IP = sh(
                                returnStdout: true,
                                script: '''
                                    set -eu

                                    if command -v ip >/dev/null 2>&1; then
                                        candidate="$(ip route get 1.1.1.1 2>/dev/null | awk '/src/ { for (i=1; i<=NF; i++) if ($i == "src") { print $(i+1); exit } }')"
                                        if [ -n "$candidate" ]; then
                                            printf '%s' "$candidate"
                                            exit 0
                                        fi
                                    fi

                                    if command -v hostname >/dev/null 2>&1; then
                                        candidate="$(hostname -I 2>/dev/null | awk '{print $1}')"
                                        if [ -n "$candidate" ]; then
                                            printf '%s' "$candidate"
                                            exit 0
                                        fi
                                    fi

                                    exit 1
                                '''
                            ).trim()
                        }

                        if (!aliasIpProvidedByUser && ciDiscoveryAliasIp && isCommonDockerBridgeIpv4(env.DISCOVERY_ALIAS_IP)) {
                            echo "Auto-detected ${env.DISCOVERY_ALIAS_IP} looks like a Docker bridge address. Overriding with Jenkins URL host ${ciDiscoveryAliasIp}."
                            env.DISCOVERY_ALIAS_IP = ciDiscoveryAliasIp
                        }

                        if (!env.DISCOVERY_ALIAS_IP) {
                            error("Could not determine a LAN IP for ${env.DISCOVERY_ALIAS_HOSTNAME}. Set DISCOVERY_ALIAS_IP explicitly.")
                        }
                        if (!aliasIpProvidedByUser && isCommonDockerBridgeIpv4(env.DISCOVERY_ALIAS_IP)) {
                            error("Auto-detected ${env.DISCOVERY_ALIAS_IP} looks like a Docker bridge address, not a stable LAN IP. Set DISCOVERY_ALIAS_IP explicitly or configure JENKINS_URL to the Jenkins host LAN URL.")
                        }

                        env.DISCOVERY_MDNS_HOSTNAME = env.DISCOVERY_ALIAS_HOSTNAME
                        env.DISCOVERY_MDNS_ADVERTISED_IPS = mergeCsv(env.DISCOVERY_MDNS_ADVERTISED_IPS, env.DISCOVERY_ALIAS_IP)
                        env.COMPOSE_PROFILES = mergeCsv(env.COMPOSE_PROFILES, 'discovery-mdns')
                        env.HTTPS_HOSTS = mergeCsv(env.HTTPS_HOSTS, env.DISCOVERY_ALIAS_HOSTNAME)

                        if (!env.FIRMWARE_PUBLIC_BASE_URL?.trim()) {
                            env.FIRMWARE_PUBLIC_BASE_URL = "https://${env.DISCOVERY_ALIAS_HOSTNAME}:3000"
                        }
                        if (!env.FIRMWARE_MQTT_BROKER?.trim()) {
                            env.FIRMWARE_MQTT_BROKER = env.DISCOVERY_ALIAS_HOSTNAME
                        }

                        echo "Discovery alias: ${env.DISCOVERY_MDNS_HOSTNAME} -> ${env.DISCOVERY_MDNS_ADVERTISED_IPS}"
                        echo "Runtime WebUI origin: ${env.FIRMWARE_PUBLIC_BASE_URL}"
                    }
                }

                sh '''
                    set -eu
                    docker version
                    docker compose version
                    docker compose config -q
                '''
            }
        }

        stage('Build Gate') {
            steps {
                echo 'Running webapp build, server tests, and find_website Docker validation before CD.'
                sh '''
                    set -eu

                    docker build \
                        --file webapp/Dockerfile \
                        --target check \
                        --tag econnect-webapp-check \
                        ./webapp

                    docker build \
                        --file server/Dockerfile \
                        --target test \
                        --tag econnect-server-test \
                        ./server

                    docker build \
                        --file find_website/Dockerfile \
                        --tag econnect-find-website-check \
                        ./find_website
                '''
            }
        }

        stage('Deploy Gate') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                script {
                    if (!(params.ALLOW_NON_MAIN_DEPLOY || ['main', 'master'].contains(env.RESOLVED_BRANCH))) {
                        error("Refusing to deploy branch '${env.RESOLVED_BRANCH}'. Set ALLOW_NON_MAIN_DEPLOY=true to override.")
                    }
                }
            }
        }

        stage('Build Active Images') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                echo 'Building all live release services including find_website and discovery_mdns'
                sh '''
                    set -eu
                    docker compose build mqtt server webapp find_website discovery_mdns
                '''
            }
        }

        stage('Deploy') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                sh '''
                    set -eu
                    docker compose up -d --wait --wait-timeout 120 --remove-orphans
                '''
            }
        }

        stage('Smoke Test') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                sh '''
                    set -eu

                    retry() {
                        attempts="$1"
                        delay="$2"
                        shift 2

                        count=1
                        while [ "$count" -le "$attempts" ]; do
                            if "$@"; then
                                return 0
                            fi

                            if [ "$count" -eq "$attempts" ]; then
                                return 1
                            fi

                            count=$((count + 1))
                            sleep "$delay"
                        done
                    }

                    docker compose port server 8000 >/dev/null
                    docker compose port find_website 9123 >/dev/null
                    retry 30 2 docker compose exec -T server python -c "import json, urllib.request; data = json.loads(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).read().decode()); assert data.get('status') == 'ok'"
                    retry 30 2 docker compose exec -T webapp node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; const main = async () => { const res = await fetch('https://127.0.0.1:3000/login'); if (!res.ok) process.exit(1); }; main().catch(() => process.exit(1))"
                    retry 30 2 docker compose exec -T find_website wget -q --spider http://127.0.0.1:9123/
                    retry 30 2 sh -c "docker compose logs discovery_mdns 2>&1 | grep -q 'Published mDNS alias'"
                    retry 30 2 sh -c "docker compose logs discovery_mdns 2>&1 | grep -F \"Published mDNS alias ${DISCOVERY_MDNS_HOSTNAME} -> ${DISCOVERY_ALIAS_IP}\""
                '''
            }
        }
    }

    post {
        always {
            sh '''
                docker compose ps || true
            '''
        }

        failure {
            sh '''
                docker compose logs --tail=200 server webapp find_website db mqtt discovery_mdns || true
            '''
            echo 'Deployment failed. Review compose status and service logs above.'
        }

        success {
            echo 'Pipeline finished successfully.'
        }
    }
}
