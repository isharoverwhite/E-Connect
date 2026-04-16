pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 120, unit: 'MINUTES')
        timestamps()
    }

    environment {
        DOCKER_BUILDKIT = '1'
        BUILDKIT_PROGRESS = 'plain'
        IMAGE_REGISTRY = 'docker.io'
        DEFAULT_DOCKER_NAMESPACE = 'ryzen30xx'
        IMAGE_MQTT = 'econnect-mqtt'
        IMAGE_SERVER = 'econnect-server'
        IMAGE_WEBAPP = 'econnect-webapp'
        SMOKE_DB_PORT = '43306'
        SMOKE_MQTT_PORT = '41883'
        SMOKE_SERVER_PORT = '18000'
        SMOKE_WEBAPP_HTTP_PORT = '13000'
        SMOKE_WEBAPP_HTTPS_PORT = '13443'
        SMOKE_PROJECT = "econnect-smoke-${BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source from GitHub...'
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: '*/main']],
                    doGenerateSubmoduleConfigurations: false,
                    extensions: [],
                    userRemoteConfigs: [[
                        url: 'https://github.com/isharoverwhite/E-Connect.git',
                        credentialsId: 'github-final-project-pat',
                    ]],
                ])
            }
        }

        stage('Preflight') {
            steps {
                script {
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

                            remote_branches="$(git for-each-ref --format='%(refname:short)' refs/remotes/origin --contains HEAD \\
                                | sed 's#^origin/##' \\
                                | grep -v '^HEAD$' || true)"

                            if [ -n "$remote_branches" ]; then
                                printf '%s\\n' "$remote_branches" | awk '/^(main|master)$/{ print; found=1; exit } END { if (!found && NR > 0) print $1 }'
                            else
                                printf 'detached'
                            fi
                        '''
                    ).trim()
                    env.GIT_SHORT_SHA = sh(returnStdout: true, script: 'git rev-parse --short=12 HEAD').trim()
                    env.HOME = env.JENKINS_HOME
                    env.DOCKER_CONFIG = "${env.JENKINS_HOME}/.docker"
                    env.DOCKER_NAMESPACE = sh(
                        returnStdout: true,
                        script: '''
                            set -eu

                            fallback="$DEFAULT_DOCKER_NAMESPACE"
                            config_file="$DOCKER_CONFIG/config.json"

                            if [ ! -f "$config_file" ]; then
                                printf '%s' "$fallback"
                                exit 0
                            fi

                            auth="$(sed -n 's/.*"auth"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$config_file" | head -n 1)"
                            if [ -n "$auth" ]; then
                                decoded="$(printf '%s' "$auth" | base64 -d 2>/dev/null || true)"
                                username="${decoded%%:*}"
                                if [ -n "$username" ]; then
                                    printf '%s' "$username"
                                    exit 0
                                fi
                            fi

                            printf '%s' "$fallback"
                        '''
                    ).trim()
                    env.SMOKE_MQTT_IMAGE = "${env.IMAGE_MQTT}:smoke-${env.BUILD_NUMBER}-${env.GIT_SHORT_SHA}"
                    env.SMOKE_SERVER_IMAGE = "${env.IMAGE_SERVER}:smoke-${env.BUILD_NUMBER}-${env.GIT_SHORT_SHA}"
                    env.SMOKE_WEBAPP_IMAGE = "${env.IMAGE_WEBAPP}:smoke-${env.BUILD_NUMBER}-${env.GIT_SHORT_SHA}"
                    env.MQTT_IMAGE_REF_LATEST = "${env.IMAGE_REGISTRY}/${env.DOCKER_NAMESPACE}/${env.IMAGE_MQTT}:latest"
                    env.SERVER_IMAGE_REF_LATEST = "${env.IMAGE_REGISTRY}/${env.DOCKER_NAMESPACE}/${env.IMAGE_SERVER}:latest"
                    env.WEBAPP_IMAGE_REF_LATEST = "${env.IMAGE_REGISTRY}/${env.DOCKER_NAMESPACE}/${env.IMAGE_WEBAPP}:latest"

                    if (!env.DOCKER_NAMESPACE?.trim()) {
                        error('Could not resolve a Docker Hub namespace from Jenkins runtime config.')
                    }

                    echo "Resolved branch: ${env.RESOLVED_BRANCH}"
                    echo "Docker namespace: ${env.DOCKER_NAMESPACE}"
                    echo "Docker config: ${env.DOCKER_CONFIG}"
                }

                sh '''
                    set -eu

                    test -f "$DOCKER_CONFIG/config.json"
                    mkdir -p "$DOCKER_CONFIG/buildx/activity"
                    find "$DOCKER_CONFIG/buildx/activity" -type f -delete || true

                    docker version
                    docker compose version
                    docker buildx version
                    docker system df || true

                    docker run --privileged --rm tonistiigi/binfmt --install arm64 >/dev/null

                    if docker buildx inspect econnect-builder >/dev/null 2>&1; then
                        docker buildx use econnect-builder
                    else
                        docker buildx create --name econnect-builder --driver docker-container --use
                    fi

                    docker buildx inspect --bootstrap | tee buildx-inspect.txt
                    grep -q 'linux/arm64' buildx-inspect.txt
                '''
            }
        }

        stage('Quality Gates') {
            parallel {
                stage('Repository Audit') {
                    steps {
                        sh '''
                            set -eu
                            docker build --pull -f - . <<'EOF'
FROM python:3.11-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY . .
RUN python3 scripts/repo_protection.py audit
EOF
                        '''
                    }
                }

                stage('Server PyTest') {
                    steps {
                        sh '''
                            set -eu
                            docker build --pull --target test ./server
                        '''
                    }
                }

                stage('Webapp Lint & Build') {
                    steps {
                        sh '''
                            set -eu
                            docker build --pull \
                                --target check \
                                --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
                                --build-arg BACKEND_INTERNAL_URL=http://server:8000 \
                                ./webapp
                        '''
                    }
                }
            }
        }

        stage('Build Smoke Images') {
            steps {
                sh '''
                    set -eu

                    docker build --pull -t "$SMOKE_MQTT_IMAGE" ./mqtt
                    docker build --pull -t "$SMOKE_SERVER_IMAGE" ./server
                    docker build --pull \
                        --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
                        --build-arg BACKEND_INTERNAL_URL=http://server:8000 \
                        -t "$SMOKE_WEBAPP_IMAGE" \
                        ./webapp
                '''
            }
        }

        stage('Smoke Test User Stack') {
            steps {
                sh '''
                    set -eu

                    mkdir -p smoke-artifacts
                    export COMPOSE_PROJECT_NAME="$SMOKE_PROJECT"
                    export DB_ROOT_PASSWORD="SmokeRoot!2026"
                    export DB_PASSWORD="SmokeApp!2026"
                    export SECRET_KEY="smoke-${BUILD_NUMBER}-${GIT_SHORT_SHA}-secret"
                    export HTTPS_HOSTS=localhost
                    export HTTPS_IPS=127.0.0.1
                    export DB_PUBLIC_PORT="$SMOKE_DB_PORT"
                    export MQTT_PUBLIC_PORT="$SMOKE_MQTT_PORT"
                    export SERVER_PUBLIC_PORT="$SMOKE_SERVER_PORT"
                    export WEBAPP_HTTP_PUBLIC_PORT="$SMOKE_WEBAPP_HTTP_PORT"
                    export WEBAPP_HTTPS_PUBLIC_PORT="$SMOKE_WEBAPP_HTTPS_PORT"
                    export DB_CONTAINER_NAME="${SMOKE_PROJECT}-db"
                    export MQTT_CONTAINER_NAME="${SMOKE_PROJECT}-mqtt"
                    export SERVER_CONTAINER_NAME="${SMOKE_PROJECT}-server"
                    export WEBAPP_CONTAINER_NAME="${SMOKE_PROJECT}-webapp"
                    export HELPER_CONTAINER_NAME="${SMOKE_PROJECT}-extension-helper"
                    export MQTT_IMAGE="$SMOKE_MQTT_IMAGE"
                    export SERVER_IMAGE="$SMOKE_SERVER_IMAGE"
                    export WEBAPP_IMAGE="$SMOKE_WEBAPP_IMAGE"
                    export MQTT_PULL_POLICY=never
                    export SERVER_PULL_POLICY=never
                    export WEBAPP_PULL_POLICY=never
                    export HELPER_PULL_POLICY=never
                    export MDNS_PULL_POLICY=never

                    cleanup() {
                        docker compose -f deploy/user/compose.yml down -v --remove-orphans || true
                    }

                    trap cleanup EXIT

                    docker compose -f deploy/user/compose.yml up -d --wait --wait-timeout 240
                    docker compose -f deploy/user/compose.yml ps | tee smoke-artifacts/compose-ps.txt

                    docker run --rm --network host curlimages/curl:8.13.0 \
                        -fsS "http://127.0.0.1:${SMOKE_SERVER_PORT}/health" \
                        | tee smoke-artifacts/server-health.json
                    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' smoke-artifacts/server-health.json

                    docker run --rm --network host curlimages/curl:8.13.0 \
                        -fsS "http://127.0.0.1:${SMOKE_WEBAPP_HTTP_PORT}/login" \
                        | tee smoke-artifacts/webapp-http.html >/dev/null
                    grep -Eiq '<!doctype html|<html' smoke-artifacts/webapp-http.html

                    docker run --rm --network host curlimages/curl:8.13.0 \
                        -kfsS "https://127.0.0.1:${SMOKE_WEBAPP_HTTPS_PORT}/login" \
                        | tee smoke-artifacts/webapp-https.html >/dev/null
                    grep -Eiq '<!doctype html|<html' smoke-artifacts/webapp-https.html
                '''
            }
        }

        stage('Package User Stack Bundle') {
            when {
                expression { return ['main', 'master'].contains(env.RESOLVED_BRANCH) }
            }
            steps {
                sh '''
                    set -eu

                    bundle_root="dist/user-stack"
                    rm -rf "$bundle_root"
                    mkdir -p "$bundle_root"

                    cp deploy/user/compose.yml "$bundle_root/compose.yml"
                    cp docker-compose.user.yml "$bundle_root/docker-compose.user.yml"

                    cat > "$bundle_root/compose.images.yml" <<EOF
services:
  mqtt:
    image: ${MQTT_IMAGE_REF_LATEST}
  server:
    image: ${SERVER_IMAGE_REF_LATEST}
  webapp:
    image: ${WEBAPP_IMAGE_REF_LATEST}
  extension_discovery_helper:
    image: ${SERVER_IMAGE_REF_LATEST}
  discovery_mdns:
    image: ${SERVER_IMAGE_REF_LATEST}
EOF

                    cat > "$bundle_root/README.txt" <<EOF
E-Connect user stack bundle

Docker Hub namespace: ${DOCKER_NAMESPACE}
Docker tag policy: latest only

Run with either compose entrypoint below:
  docker compose -f compose.yml -f compose.images.yml up -d
  docker compose -f docker-compose.user.yml -f compose.images.yml up -d
EOF

                    tar -czf "dist/econnect-user-stack-latest.tar.gz" -C "$bundle_root" .
                '''
            }
        }

        stage('Build & Push Release Images') {
            when {
                expression { return ['main', 'master'].contains(env.RESOLVED_BRANCH) }
            }
            steps {
                echo 'Publishing multi-platform release images to Docker Hub.'
                sh '''
                    set -eu

                    docker buildx build \
                        --builder econnect-builder \
                        --platform linux/amd64,linux/arm64 \
                        --pull \
                        --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
                        --build-arg BACKEND_INTERNAL_URL=http://server:8000 \
                        --tag "$WEBAPP_IMAGE_REF_LATEST" \
                        --push \
                        ./webapp

                    docker buildx build \
                        --builder econnect-builder \
                        --platform linux/amd64,linux/arm64 \
                        --pull \
                        --tag "$SERVER_IMAGE_REF_LATEST" \
                        --push \
                        ./server

                    docker buildx build \
                        --builder econnect-builder \
                        --platform linux/amd64,linux/arm64 \
                        --pull \
                        --tag "$MQTT_IMAGE_REF_LATEST" \
                        --push \
                        ./mqtt
                '''
            }
        }
    }

    post {
        always {
            archiveArtifacts allowEmptyArchive: true, artifacts: 'dist/**/*.tar.gz,dist/user-stack/**,smoke-artifacts/**,buildx-inspect.txt'

            echo 'Cleaning up smoke images and build cache...'
            sh '''
                set +e

                export COMPOSE_PROJECT_NAME="${SMOKE_PROJECT:-econnect-smoke-${BUILD_NUMBER}}"
                docker compose -f deploy/user/compose.yml down -v --remove-orphans || true

                if [ -n "${SMOKE_MQTT_IMAGE:-}" ] || [ -n "${SMOKE_SERVER_IMAGE:-}" ] || [ -n "${SMOKE_WEBAPP_IMAGE:-}" ]; then
                    docker image rm -f "${SMOKE_MQTT_IMAGE:-}" "${SMOKE_SERVER_IMAGE:-}" "${SMOKE_WEBAPP_IMAGE:-}" >/dev/null 2>&1 || true
                fi

                docker buildx prune -f || true
                docker image prune -f --filter "dangling=true" || true
            '''
        }
        success {
            echo 'Pipeline finished successfully.'
        }
        failure {
            echo 'Pipeline failed. Check build logs.'
        }
    }
}
