pipeline {
    agent any

    stages {

        stage('Pull latest code') {
            steps {
                dir('/var/www/lingo') {
                    sh 'git fetch origin main'
                    sh 'git reset --hard origin/main'
                }
            }
        }

        stage('Build Docker image') {
            steps {
                dir('/var/www/lingo') {
                    sh 'docker compose build --no-cache'
                }
            }
        }

        stage('Deploy') {
            steps {
                dir('/var/www/lingo') {
                    sh 'docker compose up -d'
                }
            }
        }

    }

    post {
        success {
            echo 'Deployed successfully.'
        }
        failure {
            echo 'Build failed.'
        }
    }
}