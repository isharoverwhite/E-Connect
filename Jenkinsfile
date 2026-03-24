pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
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
    }

    environment {
        COMPOSE_FILE = 'docker-compose.yml'
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
                echo 'Running webapp build and server tests before CD.'
                sh '''
                    set -eu

                    docker run --rm \
                        -u "$(id -u):$(id -g)" \
                        -e HOME=/tmp \
                        -e NEXT_TELEMETRY_DISABLED=1 \
                        -v "$PWD/webapp:/app" \
                        -w /app \
                        node:20-alpine \
                        sh -lc "npm ci && npm run lint && npm run build"

                    docker run --rm \
                        -u "$(id -u):$(id -g)" \
                        -e HOME=/tmp \
                        -e PIP_DISABLE_PIP_VERSION_CHECK=1 \
                        -v "$PWD/server:/app" \
                        -w /app \
                        python:3.11-slim \
                        sh -lc "python -m pip install --upgrade pip && pip install -r requirements-dev.txt && python -m pytest tests/"
                '''
            }
        }

        stage('Build Active Images') {
            steps {
                echo 'Building active release services: server + webapp'
                sh '''
                    set -eu
                    docker compose build server webapp
                '''
            }
        }

        stage('Deploy') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                script {
                    if (!(params.ALLOW_NON_MAIN_DEPLOY || ['main', 'master'].contains(env.RESOLVED_BRANCH))) {
                        error("Refusing to deploy branch '${env.RESOLVED_BRANCH}'. Set ALLOW_NON_MAIN_DEPLOY=true to override.")
                    }
                }

                sh '''
                    set -eu
                    docker compose up -d --remove-orphans
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

                    retry 30 2 docker compose exec -T server python -c "import json, urllib.request; data = json.loads(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).read().decode()); assert data.get('status') == 'ok'"
                    retry 30 2 docker compose exec -T webapp node -e "const main = async () => { const res = await fetch('http://127.0.0.1:3000/login'); if (!res.ok) process.exit(1); }; main().catch(() => process.exit(1))"
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
                docker compose logs --tail=200 server webapp db mqtt || true
            '''
            echo 'Deployment failed. Review compose status and service logs above.'
        }

        success {
            echo 'Pipeline finished successfully.'
        }
    }
}
